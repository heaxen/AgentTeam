import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAuth } from '../src/auth.js';

async function tmp(name) {
  return mkdtemp(join(tmpdir(), `agentteam-${name}-`));
}

// 捕获 console.log 输出，用于确认密钥没有被打印。
async function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const result = await fn();
    return { result, output: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

test('auth 选择 2：粘贴 API key 保存为 api 方式，输出中不出现 key', async () => {
  const dir = await tmp('auth');
  const file = join(dir, 'credentials.json');
  const secret = 'sk-test-SECRET-123';
  const { result, output } = await captureLog(() =>
    runAuth({ id: 'claude', log: console.log, file, ask: async () => '2', askKey: async () => secret, runLogin: async () => 9 }),
  );
  assert.equal(result, 0);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.agents.claude.method, 'api');
  assert.equal(saved.agents.claude.apiKey, secret);
  assert.equal(output.includes(secret), false, '密钥不得出现在输出中');
});

test('auth 选择 1：订阅登录，登录命令成功后记录 subscription', async () => {
  const dir = await tmp('auth-sub');
  const file = join(dir, 'credentials.json');
  let launched = null;
  const code = await runAuth({
    id: 'claude',
    log: () => {},
    file,
    ask: async () => '1',
    askKey: async () => {
      throw new Error('选择订阅时不应询问 key');
    },
    runLogin: async (agent) => {
      launched = agent.id;
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.equal(launched, 'claude');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.agents.claude.method, 'subscription');
});

test('只有手动登录的 agent 选 1：给出手动步骤，不写入认证状态', async () => {
  const dir = await tmp('auth-manual');
  const file = join(dir, 'credentials.json');
  const { result, output } = await captureLog(() =>
    runAuth({ id: 'gemini', log: console.log, file, ask: async () => '1', askKey: async () => '' }),
  );
  assert.equal(result, 0);
  assert.match(output, /agentteam auth gemini --confirm/);
  await assert.rejects(readFile(file, 'utf8'), 'ENOENT');
});

test('deepseek（仅 API）：直接要求粘贴 key，留空则失败且不保存', async () => {
  const dir = await tmp('auth-api');
  const file = join(dir, 'credentials.json');
  let asked = 0;
  const code = await runAuth({
    id: 'deepseek',
    log: () => {},
    file,
    ask: async () => {
      throw new Error('仅 API 的 agent 不应出现选择题');
    },
    askKey: async () => {
      asked += 1;
      return '';
    },
  });
  assert.equal(code, 1);
  assert.equal(asked, 1);
  await assert.rejects(readFile(file, 'utf8'), 'ENOENT');
});
