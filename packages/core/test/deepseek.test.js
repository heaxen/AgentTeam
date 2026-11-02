import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deepseekAdapter, resolveInside } from '../src/adapters/deepseek.js';
import { loadAllowedCommands, assertAllowedCommand } from '../src/allowlist.js';
import { buildCommand as claudeCommand } from '../src/adapters/claude.js';

const TIMEOUT = 30_000;

async function project() {
  return mkdtemp(join(tmpdir(), 'agentteam-ds-'));
}

// 按顺序返回预设的模型回复；记录每次请求体，便于断言。
function scriptedFetch(replies) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const reply = replies.shift();
    if (!reply) throw new Error('脚本已用完');
    if (reply.status) return { ok: false, status: reply.status, text: async () => reply.text ?? '' };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: reply }] }) };
  };
  return { fetchImpl, requests };
}

const toolCall = (id, name, args) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

test('路径必须在项目内：绝对路径、.. 越界、.git 都被拒绝', () => {
  const root = resolve(tmpdir(), 'proj');
  assert.equal(resolveInside(root, 'docs/a.md'), join(root, 'docs', 'a.md'));
  assert.throws(() => resolveInside(root, '/etc/passwd'), /相对/);
  assert.throws(() => resolveInside(root, '../secret'), /越出项目目录/);
  assert.throws(() => resolveInside(root, '.git/config'), /\.git/);
  assert.throws(() => resolveInside(root, ''), /不能为空/);
});

test('工具循环：模型先写文件，再给出最终回复', async () => {
  const root = await project();
  const { fetchImpl, requests } = scriptedFetch([
    toolCall('c1', 'write_file', { path: 'docs/backend/IMPL-001.md', content: '实现说明' }),
    { role: 'assistant', content: '已完成', tool_calls: undefined },
  ]);

  const result = await deepseekAdapter.run({
    prompt: '任务正文',
    cwd: root,
    credential: { method: 'api', apiKey: 'sk-test' },
    timeoutMs: TIMEOUT,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, '已完成');
  assert.equal(await readFile(join(root, 'docs', 'backend', 'IMPL-001.md'), 'utf8'), '实现说明');
  assert.equal(requests[0].auth, 'Bearer sk-test');
  assert.equal(requests[0].body.model, 'deepseek-v4-pro');
  // 第二次请求必须带上工具结果，且 tool_call_id 对应
  const toolMsg = requests[1].body.messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
});

test('工具出错不中断任务：错误作为工具结果返回模型', async () => {
  const root = await project();
  const { fetchImpl, requests } = scriptedFetch([
    toolCall('c1', 'read_file', { path: '../../etc/hosts' }),
    { role: 'assistant', content: '好的，改用项目内路径', tool_calls: undefined },
  ]);
  const result = await deepseekAdapter.run({ prompt: 'x', cwd: root, credential: { apiKey: 'k' }, timeoutMs: TIMEOUT, fetchImpl });
  assert.equal(result.ok, true);
  assert.match(requests[1].body.messages.at(-1).content, /越出项目目录/);
});

test('run_command 只能执行整条匹配的允许命令；未允许的命令不会执行', async () => {
  const root = await project();
  const { fetchImpl, requests } = scriptedFetch([
    toolCall('c1', 'run_command', { command: 'node --version' }),
    toolCall('c2', 'run_command', { command: 'node -e "process.exit(9)"' }),
    { role: 'assistant', content: 'done', tool_calls: undefined },
  ]);
  await deepseekAdapter.run({
    prompt: 'x',
    cwd: root,
    credential: { apiKey: 'k' },
    timeoutMs: TIMEOUT,
    allowedCommands: ['node --version'],
    fetchImpl,
  });
  const allowedOut = requests[1].body.messages.find((m) => m.tool_call_id === 'c1').content;
  const blockedOut = requests[2].body.messages.find((m) => m.tool_call_id === 'c2').content;
  assert.match(allowedOut, /退出码 0/);
  assert.match(blockedOut, /命令未被项目允许/);
});

test('缺少 key 时直接失败，不发请求', async () => {
  const root = await project();
  const { fetchImpl, requests } = scriptedFetch([]);
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = await deepseekAdapter.run({ prompt: 'x', cwd: root, credential: {}, timeoutMs: TIMEOUT, fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.error, /缺少 DeepSeek API key/);
    assert.equal(requests.length, 0);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('HTTP 错误如实返回，且错误信息不包含 key', async () => {
  const root = await project();
  const { fetchImpl } = scriptedFetch([{ status: 401, text: 'invalid token' }]);
  const result = await deepseekAdapter.run({ prompt: 'x', cwd: root, credential: { apiKey: 'sk-secret' }, timeoutMs: TIMEOUT, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 401/);
  assert.doesNotMatch(result.error, /sk-secret/);
});

test('允许命令清单：缺失时为空；含 shell 元字符时拒绝', async () => {
  const root = await project();
  assert.deepEqual(await loadAllowedCommands(root), []);
  await mkdir(join(root, 'team'), { recursive: true });
  await writeFile(join(root, 'team', 'allowed-commands.json'), JSON.stringify({ commands: ['npm test', 'npm run build'] }));
  assert.deepEqual(await loadAllowedCommands(root), ['npm test', 'npm run build']);
  assert.throws(() => assertAllowedCommand('npm test; rm -rf /'), /不合法/);
  assert.throws(() => assertAllowedCommand('npm "test"'), /不合法/);
});

test('claude 的 --allowedTools：每条允许命令生成两种模式，并经白名单校验', () => {
  const command = claudeCommand({ allowedCommands: ['npm test'] });
  assert.equal(
    command,
    'claude -p --output-format json --permission-mode acceptEdits --allowedTools "Bash(npm test)" "Bash(npm test *)"',
  );
  assert.throws(() => claudeCommand({ allowedCommands: ['npm test && calc'] }), /不合法/);
  // 没有允许命令时不加 --allowedTools
  assert.equal(claudeCommand({ allowedCommands: [] }).includes('--allowedTools'), false);
});
