import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChatCommand, completeChatInput } from '../src/chat.js';

async function tmp(name) {
  return mkdtemp(join(tmpdir(), `agentteam-${name}-`));
}

// 按顺序返回预设回答，用完后返回 null（相当于输入结束）。
function scripted(answers) {
  const queue = [...answers];
  const next = async () => (queue.length ? queue.shift() : null);
  return { line: next, secret: next, close() {} };
}

// 认证总是成功，并且不读取真实的 ~/.agentteam/credentials.json。
const authOk = async () => true;

async function readAssignments(root) {
  return JSON.parse(await readFile(join(root, 'team', 'assignments.json'), 'utf8'));
}

test('/assign：认证后依次选择模型与思考强度，保存到 team/assignments.json', async () => {
  const root = await tmp('chat-assign');
  // codex 的模型：2 = gpt-5.1-codex-max；思考强度：4 = high
  const reply = await runChatCommand(root, '/assign backend-dev codex', {
    prompt: scripted(['2', '4']),
    log: () => {},
    authFn: authOk,
  });
  assert.equal(reply, '配置已保存。');
  const saved = await readAssignments(root);
  assert.deepEqual(saved.assignments['backend-dev'], {
    agent: 'codex',
    model: 'gpt-5.1-codex-max',
    effort: 'high',
  });
});

test('/assign：未认证则不改配置', async () => {
  const root = await tmp('chat-assign-noauth');
  const reply = await runChatCommand(root, '/assign backend-dev codex', {
    prompt: scripted([]),
    log: () => {},
    authFn: async () => false,
  });
  assert.match(reply, /未完成认证/);
  await assert.rejects(readFile(join(root, 'team', 'assignments.json'), 'utf8'), 'ENOENT');
});

test('/assign：未知角色或未知 agent 给出原因', async () => {
  const root = await tmp('chat-assign-bad');
  const bad = await runChatCommand(root, '/assign nobody codex', {
    prompt: scripted(['1', '1']),
    log: () => {},
    authFn: authOk,
  });
  assert.match(bad, /未知角色/);
  const badAgent = await runChatCommand(root, '/assign backend-dev nope', {
    prompt: scripted(['1']),
    log: () => {},
    authFn: authOk,
  });
  assert.match(badAgent, /nope/);
  assert.match(await runChatCommand(root, '/assign', { prompt: scripted([]), authFn: authOk }), /用法/);
});

test('/assign all：全部角色使用同一个 agent 与所选模型', async () => {
  const root = await tmp('chat-assign-all');
  // gemini 不支持思考强度，只问模型：1 = agent 默认
  const reply = await runChatCommand(root, '/assign all gemini', {
    prompt: scripted(['1']),
    log: () => {},
    authFn: authOk,
  });
  assert.equal(reply, '配置已保存。');
  const saved = await readAssignments(root);
  assert.equal(saved.assignments['qa'].agent, 'gemini');
});

test('/model：选择模型（claude 第 2 项为 claude-opus-5-5），思考强度选 agent 默认', async () => {
  const root = await tmp('chat-model');
  const reply = await runChatCommand(root, '/model backend-dev', {
    prompt: scripted(['2', '1']),
    log: () => {},
  });
  assert.equal(reply, '配置已保存。');
  const saved = await readAssignments(root);
  assert.deepEqual(saved.assignments['backend-dev'], {
    agent: 'claude',
    model: 'claude-opus-5-5',
    effort: null,
  });
});

test('/model：手动输入模型名时，非法名称会被拒绝并重新询问', async () => {
  const root = await tmp('chat-model-custom');
  const logs = [];
  // claude 有 4 个模型，所以“其他”是第 6 项；非法名后回车取消
  const reply = await runChatCommand(root, '/model backend-dev', {
    prompt: scripted(['6', 'bad;rm', '']),
    log: (msg) => logs.push(msg),
  });
  assert.match(reply, /已取消/);
  assert.ok(logs.some((msg) => /模型名只能包含/.test(msg)));
});

test('/effort：只改思考强度，模型保持不变', async () => {
  const root = await tmp('chat-effort');
  await runChatCommand(root, '/assign backend-dev codex', {
    prompt: scripted(['2', '4']),
    log: () => {},
    authFn: authOk,
  });
  // codex 的思考强度：1 默认，2 low，3 medium，4 high
  const reply = await runChatCommand(root, '/effort backend-dev', {
    prompt: scripted(['3']),
    log: () => {},
  });
  assert.equal(reply, '配置已保存。');
  const saved = await readAssignments(root);
  assert.deepEqual(saved.assignments['backend-dev'], {
    agent: 'codex',
    model: 'gpt-5.1-codex-max',
    effort: 'medium',
  });
});

test('/effort：agent 不支持思考强度时给出说明', async () => {
  const root = await tmp('chat-effort-gemini');
  await runChatCommand(root, '/assign backend-dev gemini', {
    prompt: scripted(['1']),
    log: () => {},
    authFn: authOk,
  });
  const reply = await runChatCommand(root, '/effort backend-dev', { prompt: scripted([]), log: () => {} });
  assert.match(reply, /不支持按次设置思考强度/);
});

test('/team 列出每个角色的 agent、模型与思考强度（默认值显示为 agent 默认）', async () => {
  const root = await tmp('chat-team');
  const team = await runChatCommand(root, '/team');
  assert.match(team, /后端开发（backend-dev）  claude  模型：（agent 默认）  思考：（agent 默认）/);
});

test('/team 显示已保存的模型与思考强度', async () => {
  const root = await tmp('chat-team-saved');
  await runChatCommand(root, '/assign backend-dev codex', {
    prompt: scripted(['2', '4']),
    log: () => {},
    authFn: authOk,
  });
  const team = await runChatCommand(root, '/team');
  assert.match(team, /后端开发（backend-dev）  codex  模型：gpt-5.1-codex-max  思考：high/);
});

test('/help 包含设置命令与角色列表；未知命令有提示', async () => {
  const root = await tmp('chat-help');
  const help = await runChatCommand(root, '/help');
  assert.match(help, /\/auth <agent>/);
  assert.match(help, /\/assign <角色>/);
  assert.match(help, /\/effort <角色>/);
  assert.match(help, /backend-dev/);
  assert.match(await runChatCommand(root, '/foo'), /未知命令：\/foo/);
});

test('Tab 补全：斜杠命令、角色名、agent 名', () => {
  const opts = { roles: ['backend-dev', 'qa'], agents: ['claude', 'codex'] };
  assert.deepEqual(completeChatInput('/a', opts), ['/agents', '/auth', '/assign'].filter((c) => c.startsWith('/a')));
  assert.deepEqual(completeChatInput('/assign ', opts), ['/assign backend-dev', '/assign qa', '/assign all']);
  assert.deepEqual(completeChatInput('/assign b', opts), ['/assign backend-dev']);
  assert.deepEqual(completeChatInput('/assign backend-dev c', opts), ['/assign backend-dev claude', '/assign backend-dev codex']);
  assert.deepEqual(completeChatInput('/auth co', opts), ['/auth codex']);
  assert.deepEqual(completeChatInput('/model q', opts), ['/model qa']);
  assert.deepEqual(completeChatInput('普通需求', opts), []);
});
