import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommand as claudeCommand } from '../src/adapters/claude.js';
import { buildCommand as codexCommand } from '../src/adapters/codex.js';
import { deepseekAdapter } from '../src/adapters/deepseek.js';
import { assignRole, setRoleEffort, checkEffort, resolveAssignments } from '../src/assign.js';

const TIMEOUT = 30_000;

async function tmp(name) {
  return mkdtemp(join(tmpdir(), `agentteam-${name}-`));
}

// 按顺序返回预设的模型回复，并记录每次请求体。
function scriptedFetch(replies) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const reply = replies.shift();
    if (!reply) throw new Error('脚本已用完');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: reply }] }) };
  };
  return { fetchImpl, requests };
}

test('claude 思考强度：传入 --effort，未指定时不出现', () => {
  assert.match(claudeCommand({ model: 'claude-opus-5-5', effort: 'high' }), /--effort high/);
  assert.doesNotMatch(claudeCommand({ model: 'claude-opus-5-5' }), /--effort/);
});

test('codex 思考强度：通过 -c model_reasoning_effort 传入', () => {
  const command = codexCommand({ outputFile: 'out.md', effort: 'high' });
  assert.match(command, /-c model_reasoning_effort=high/);
  assert.doesNotMatch(codexCommand({ outputFile: 'out.md' }), /model_reasoning_effort/);
});

test('deepseek 思考强度：high 开启 thinking 并带 reasoning_effort；off 关闭 thinking；未指定不带字段', async () => {
  const root = await tmp('ds-effort');
  const credential = { method: 'api', apiKey: 'sk-test' };

  const on = scriptedFetch([{ role: 'assistant', content: 'ok' }]);
  await deepseekAdapter.run({ prompt: 'p', cwd: root, model: 'deepseek-v4-pro', effort: 'high', credential, timeoutMs: TIMEOUT, fetchImpl: on.fetchImpl });
  assert.deepEqual(on.requests[0].body.thinking, { type: 'enabled' });
  assert.equal(on.requests[0].body.reasoning_effort, 'high');

  const off = scriptedFetch([{ role: 'assistant', content: 'ok' }]);
  await deepseekAdapter.run({ prompt: 'p', cwd: root, model: 'deepseek-v4-pro', effort: 'off', credential, timeoutMs: TIMEOUT, fetchImpl: off.fetchImpl });
  assert.deepEqual(off.requests[0].body.thinking, { type: 'disabled' });
  assert.equal(off.requests[0].body.reasoning_effort, undefined);

  const none = scriptedFetch([{ role: 'assistant', content: 'ok' }]);
  await deepseekAdapter.run({ prompt: 'p', cwd: root, model: 'deepseek-v4-pro', credential, timeoutMs: TIMEOUT, fetchImpl: none.fetchImpl });
  assert.equal(none.requests[0].body.thinking, undefined);
  assert.equal(none.requests[0].body.reasoning_effort, undefined);
});

test('checkEffort：只接受 agent 支持的取值；gemini 不支持按次设置', () => {
  assert.equal(checkEffort('codex', 'high'), 'high');
  assert.equal(checkEffort('codex', ''), null);
  assert.throws(() => checkEffort('codex', 'bogus'), /可选：/);
  assert.throws(() => checkEffort('gemini', 'high'), /不支持按次设置思考强度/);
});

test('assignRole：换 agent 时旧的思考强度不会保留', async () => {
  const root = await tmp('assign-effort');
  await assignRole(root, 'qa', 'codex', 'gpt-5', 'high');
  await assignRole(root, 'qa', 'claude');
  const resolved = await resolveAssignments(root);
  assert.deepEqual(resolved.qa, { agent: 'claude', model: null, effort: null });
});

test('setRoleEffort：只改强度，agent 与模型保留', async () => {
  const root = await tmp('set-effort');
  await assignRole(root, 'backend-dev', 'codex', 'gpt-5');
  await setRoleEffort(root, 'backend-dev', 'medium');
  const saved = JSON.parse(await readFile(join(root, 'team', 'assignments.json'), 'utf8'));
  assert.deepEqual(saved.assignments['backend-dev'], { agent: 'codex', model: 'gpt-5', effort: 'medium' });
});

test('setRoleEffort：gemini 或未知强度被拒绝，文件不变', async () => {
  const root = await tmp('set-effort-bad');
  await assignRole(root, 'qa', 'gemini');
  await assert.rejects(setRoleEffort(root, 'qa', 'high'), /不支持按次设置思考强度/);
  await assert.rejects(setRoleEffort(root, 'qa', 'bogus'), /不支持按次设置思考强度/);
});
