import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess, toRunResult } from '../src/adapters/process.js';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { geminiAdapter } from '../src/adapters/gemini.js';
import { deepseekAdapter } from '../src/adapters/deepseek.js';
import { dispatchTask } from '../src/dispatch.js';
import { saveAgentCredential } from '../src/credentials.js';

const SLEEP = 'node -e "setTimeout(function(){},20000)"';

function abortedSignal() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

test('runProcess：signal 触发后终止子进程并返回 cancelled', async () => {
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 300);
  const result = await runProcess({
    command: SLEEP,
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 60000,
    signal: controller.signal,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.ok(Date.now() - started < 10000, '应在取消后很快返回，而不是等到超时');
});

test('runProcess：signal 已经触发时不启动进程', async () => {
  const result = await runProcess({
    command: 'node -e "process.exit(7)"',
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5000,
    signal: abortedSignal(),
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.code, null);
  assert.equal(result.stdout, '');
});

test('toRunResult：cancelled 报"已取消"，不算成功', () => {
  const result = toRunResult({ code: null, stderr: '', timedOut: false, cancelled: true }, '', undefined);
  assert.equal(result.ok, false);
  assert.equal(result.error, '已取消');
  assert.equal(result.text, '');
});

// 下面四个适配器用"signal 已触发"驱动：runProcess 不会启动任何进程，所以不会真的调用 agent。
test('claude 适配器：流式与非流式都在取消时返回"已取消"', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'agentteam-cancel-'));
  const base = { prompt: 'x', cwd, timeoutMs: 5000, signal: abortedSignal() };
  const plain = await claudeAdapter.run(base);
  assert.equal(plain.ok, false);
  assert.equal(plain.error, '已取消');
  const streamed = await claudeAdapter.run({ ...base, onOutput: () => {} });
  assert.equal(streamed.ok, false);
  assert.equal(streamed.error, '已取消');
});

test('codex 与 gemini 适配器：取消时返回"已取消"', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'agentteam-cancel-'));
  const base = { prompt: 'x', cwd, timeoutMs: 5000, signal: abortedSignal() };
  const codex = await codexAdapter.run(base);
  assert.equal(codex.ok, false);
  assert.equal(codex.error, '已取消');
  const gemini = await geminiAdapter.run(base);
  assert.equal(gemini.ok, false);
  assert.equal(gemini.error, '已取消');
});

test('deepseek 适配器：取消时不发请求', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'agentteam-cancel-'));
  let called = 0;
  const result = await deepseekAdapter.run({
    prompt: 'x',
    cwd,
    timeoutMs: 5000,
    credential: { apiKey: 'sk-test' },
    fetchImpl: async () => {
      called += 1;
      throw new Error('不应被调用');
    },
    signal: abortedSignal(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, '已取消');
  assert.equal(called, 0);
});

test('dispatchTask：把 signal 传给适配器，取消时返回"已取消"', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-cancel-'));
  await mkdir(join(root, 'team', 'tasks'), { recursive: true });
  await writeFile(join(root, 'team', 'tasks', 'T-001.md'), '# T-001\n目标：测试取消\n', 'utf8');
  const credentialsFile = join(root, 'credentials.json');
  await saveAgentCredential('claude', { method: 'subscription', loggedInAt: new Date().toISOString() }, credentialsFile);
  const result = await dispatchTask({ root, taskId: 'T-001', role: 'qa', credentialsFile, signal: abortedSignal() });
  assert.equal(result.ok, false);
  assert.equal(result.error, '已取消');
});

test('runProcess：取消之后管道里残留的输出不再转发给 onChunk', async () => {
  const controller = new AbortController();
  let chunks = 0;
  const run = runProcess({
    command: 'node -e "setInterval(function(){console.log(1)},50)"',
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 60000,
    signal: controller.signal,
    onChunk: () => {
      chunks += 1;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  controller.abort();
  const result = await run;
  assert.equal(result.cancelled, true);
  const atCancel = chunks;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(chunks, atCancel, '取消返回之后不应再有回调');
});

test('deepseek 适配器：取消后同一批里剩下的工具不再执行', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'agentteam-cancel-'));
  const controller = new AbortController();
  const command = SLEEP;
  let calls = 0;
  const result = await deepseekAdapter.run({
    prompt: 'x',
    cwd,
    timeoutMs: 30000,
    allowedCommands: [command],
    credential: { apiKey: 'sk-test' },
    fetchImpl: async () => {
      calls += 1;
      // 第一个工具是长时间运行的命令，第二个是写文件；在第一个工具执行期间取消。
      setTimeout(() => controller.abort(), 300);
      const message = {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command }) } },
          { id: 'c2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'out.txt', content: 'x' }) } },
        ],
      };
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    },
    signal: controller.signal,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, '已取消');
  assert.equal(calls, 1);
  await assert.rejects(access(join(cwd, 'out.txt')), '取消后不应写出文件');
});
