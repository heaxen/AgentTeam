import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess, lineSplitter, trackOutput } from '../src/adapters/process.js';
import { deepseekAdapter } from '../src/adapters/deepseek.js';
import { buildCommand as claudeCommand, parseStreamLine, toStreamRunResult, createStreamCollector } from '../src/adapters/claude.js';

test('runProcess 把 stdout 逐段交给 onChunk，同时仍然返回完整输出', async () => {
  // 子进程写出 a 后等标记文件出现才写 b；标记文件由 onChunk 在收到第一段时创建，所以两段必然分开到达。
  const dir = await mkdtemp(join(tmpdir(), 'agentteam-chunk-'));
  const marker = join(dir, 'marker');
  const script = join(dir, 'child.js');
  await writeFile(
    script,
    `const fs = require('fs');
process.stdout.write('a');
const start = Date.now();
const timer = setInterval(() => {
  if (fs.existsSync(process.argv[2]) || Date.now() - start > 10000) {
    clearInterval(timer);
    process.stdout.write('b');
  }
}, 20);
`,
  );
  const chunks = [];
  const result = await runProcess({
    command: `node "${script}" "${marker}"`,
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20000,
    onChunk: (text) => {
      chunks.push(text);
      writeFileSync(marker, '1');
    },
  });
  assert.equal(chunks[0], 'a');
  assert.equal(chunks.join(''), 'ab');
  assert.equal(result.stdout, 'ab');
});

test('runProcess：onChunk 抛错不影响运行，仍返回完整 stdout', async () => {
  const result = await runProcess({
    command: `node -e "process.stdout.write('hello')"`,
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10000,
    onChunk: () => {
      throw new Error('boom');
    },
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello');
});

test('runProcess：被切在两段之间的中文字符不会乱码', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentteam-utf8-'));
  const script = join(dir, 'child.js');
  await writeFile(
    script,
    `const buf = Buffer.from('中文');
process.stdout.write(buf.subarray(0, 2));
setTimeout(() => process.stdout.write(buf.subarray(2)), 100);
`,
  );
  const chunks = [];
  const result = await runProcess({
    command: `node "${script}"`,
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10000,
    onChunk: (text) => chunks.push(text),
  });
  assert.equal(chunks.join(''), '中文');
  assert.equal(result.stdout, '中文');
});

test('lineSplitter 把被任意切开的文本拼成完整的行，end 冲出最后不带换行的一行', () => {
  const lines = [];
  const splitter = lineSplitter((line) => lines.push(line));
  splitter.push('{"a":');
  splitter.push('1}\n{"b":2}\n\n{"c"');
  splitter.push(':3}');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  splitter.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('trackOutput：过程中有输出就不重复发最终文本，没有才补发一次', () => {
  const got = [];
  const streamed = trackOutput((t) => got.push(t));
  streamed.onChunk('过程');
  streamed.finish('最终');
  assert.deepEqual(got, ['过程']);

  const silent = [];
  const quiet = trackOutput((t) => silent.push(t));
  quiet.finish('最终');
  quiet.finish('');
  assert.deepEqual(silent, ['最终']);

  const none = trackOutput(undefined);
  assert.equal(none.onChunk, undefined);
  assert.doesNotThrow(() => none.finish('最终'));
});

test('deepseek 把每条模型回复交给 onOutput', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { role: 'assistant', content: '完成' } }] }),
  });
  const out = [];
  const result = await deepseekAdapter.run({
    prompt: 'x',
    cwd: await mkdtemp(join(tmpdir(), 'agentteam-ds-')),
    credential: { apiKey: 'k' },
    timeoutMs: 5000,
    fetchImpl,
    onOutput: (t) => out.push(t),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(out, ['完成\n']);
});

test('claude 流式命令：用 stream-json 与 --verbose，普通命令保持不变', () => {
  assert.equal(
    claudeCommand({ stream: true }),
    'claude -p --output-format stream-json --verbose --permission-mode acceptEdits',
  );
  assert.equal(claudeCommand(), 'claude -p --output-format json --permission-mode acceptEdits');
});

test('parseStreamLine：取出 assistant 的文本块与结束事件，忽略其他行', () => {
  const assistant = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '先看文件' }, { type: 'tool_use', name: 'Read' }, { type: 'text', text: '再改' }] },
  });
  assert.deepEqual(parseStreamLine(assistant), { texts: ['先看文件', '再改'] });

  const result = JSON.stringify({ type: 'result', result: '完成', is_error: false });
  assert.deepEqual(parseStreamLine(result), { texts: [], result: { text: '完成', isError: false } });

  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'user' })), { texts: [] });
  assert.deepEqual(parseStreamLine('不是 JSON'), { texts: [] });
});

test('真实采集的 claude 样本：能解析出文本和结束事件', async () => {
  const text = await readFile(new URL('./fixtures/claude-stream.jsonl', import.meta.url), 'utf8');
  const parsed = text.split('\n').filter(Boolean).map(parseStreamLine);
  assert.ok(parsed.flatMap((p) => p.texts).length > 0, '应能取出至少一段文本');
  const finals = parsed.filter((p) => p.result);
  assert.equal(finals.length, 1, '应有且只有一个结束事件');
  assert.equal(finals[0].result.isError, false);
  assert.ok(finals[0].result.text.length > 0);
});

test('claude 流式结果：结束事件优先于退出码', () => {
  // (a) 结束事件成功，退出码 1：仍算成功
  const a = toStreamRunResult({ code: 1, stderr: ' warn ', timedOut: false }, { text: '完成', isError: false });
  assert.equal(a.ok, true);
  assert.equal(a.text, '完成');
  assert.equal(a.error, undefined);
  assert.equal(a.exitCode, 1);
  assert.equal(a.stderr, 'warn');

  // (b) 结束事件报错，退出码 0：算失败，错误里带结果文本
  const b = toStreamRunResult({ code: 0, stderr: '', timedOut: false }, { text: '出错了', isError: true });
  assert.equal(b.ok, false);
  assert.equal(b.text, '');
  assert.match(b.error, /出错了/);

  // (c) 超时且没有结束事件：报超时
  const c = toStreamRunResult({ code: null, stderr: '', timedOut: true }, null);
  assert.equal(c.ok, false);
  assert.equal(c.timedOut, true);
  assert.equal(c.error, '执行超时，已终止');

  // (d) 没有结束事件且退出码 0：报没有结束事件
  const d = toStreamRunResult({ code: 0, stderr: '', timedOut: false }, null);
  assert.equal(d.ok, false);
  assert.match(d.error, /没有结束事件/);
});

test('parseStreamLine：意外结构一律返回空文本，不抛错', () => {
  assert.deepEqual(parseStreamLine('null'), { texts: [] });
  assert.deepEqual(parseStreamLine('42'), { texts: [] });
  assert.deepEqual(parseStreamLine('"text"'), { texts: [] });
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: '字符串' } })), { texts: [] });
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'assistant' })), { texts: [] });
  assert.deepEqual(
    parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [null, 3, { type: 'text', text: '好' }] } })),
    { texts: ['好'] },
  );
});

test('流式收集：onOutput 抛错不丢同一段里的结束事件，也不中断后续行', () => {
  const assistant = (t) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
  const result = JSON.stringify({ type: 'result', result: '完成', is_error: false });
  const seen = [];
  const collector = createStreamCollector((text) => {
    seen.push(text);
    if (seen.length === 1) throw new Error('boom');
  });
  collector.push([assistant('甲'), assistant('乙'), result, ''].join('\n'));
  collector.end();
  assert.deepEqual(seen, ['甲\n', '乙\n']);
  assert.deepEqual(collector.final(), { text: '完成', isError: false });

  // 末尾没有换行的最后一行由 end() 处理，onOutput 抛错也不让 end() 抛出
  const tail = createStreamCollector(() => {
    throw new Error('boom');
  });
  tail.push([assistant('丙'), result].join('\n'));
  assert.doesNotThrow(() => tail.end());
  assert.deepEqual(tail.final(), { text: '完成', isError: false });
});

test('claude 流式结果：超时时丢弃结束事件，仍报超时', () => {
  const r = toStreamRunResult({ code: null, stderr: '', timedOut: true }, { text: '完成', isError: false });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.error, '执行超时，已终止');
});
