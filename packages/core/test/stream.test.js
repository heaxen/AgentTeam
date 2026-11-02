import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess, lineSplitter, trackOutput } from '../src/adapters/process.js';
import { deepseekAdapter } from '../src/adapters/deepseek.js';

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
