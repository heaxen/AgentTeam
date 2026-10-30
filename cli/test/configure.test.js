import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseFrom,
  assignRoleWithChain,
  assignAllWithChain,
  changeEffortWithChain,
  changeModelWithChain,
} from '../src/configure.js';
import { assignRole } from '../src/assign.js';

async function tmp(name) {
  return mkdtemp(join(tmpdir(), `agentteam-${name}-`));
}

// 按顺序返回预设回答，用完后返回 null（相当于输入结束）。
function scripted(answers) {
  const queue = [...answers];
  const next = async () => (queue.length ? queue.shift() : null);
  return { line: next, secret: next, close() {} };
}

const authOk = async () => true;

function collector() {
  const lines = [];
  return { lines, log: (msg) => lines.push(msg) };
}

async function readAssignments(root) {
  return JSON.parse(await readFile(join(root, 'team', 'assignments.json'), 'utf8'));
}

test('chooseFrom：回车选第一项，数字选对应项', async () => {
  const options = [
    { label: 'a', value: 'A' },
    { label: 'b', value: 'B' },
  ];
  const { log } = collector();
  assert.equal(await chooseFrom({ prompt: scripted(['']), log, title: 't', options }), 'A');
  assert.equal(await chooseFrom({ prompt: scripted(['2']), log, title: 't', options }), 'B');
});

test('chooseFrom：非法编号会提示并重新询问', async () => {
  const options = [
    { label: 'a', value: 'A' },
    { label: 'b', value: 'B' },
  ];
  const { lines, log } = collector();
  const value = await chooseFrom({ prompt: scripted(['x', '9', '2']), log, title: 't', options });
  assert.equal(value, 'B');
  assert.equal(lines.filter((l) => /请输入 1 到 2 之间的编号/.test(l)).length, 2);
});

test('chooseFrom：输入结束返回 undefined', async () => {
  const options = [{ label: 'a', value: 'A' }];
  const { log } = collector();
  assert.equal(await chooseFrom({ prompt: scripted([]), log, title: 't', options }), undefined);
});

test('链式配置 codex：认证 → 模型 2 → 思考强度 4，保存完整配置', async () => {
  const root = await tmp('cfg-codex');
  const file = join(await tmp('cfg-codex-cred'), 'credentials.json');
  const { log } = collector();
  const result = await assignRoleWithChain({
    root,
    prompt: scripted(['2', '4']),
    log,
    role: 'backend-dev',
    agentId: 'codex',
    file,
    authFn: authOk,
  });
  assert.equal(result.saved, true);
  assert.deepEqual(result.picked, { model: 'gpt-5.1-codex-max', effort: 'high' });
  const saved = await readAssignments(root);
  assert.deepEqual(saved.assignments['backend-dev'], { agent: 'codex', model: 'gpt-5.1-codex-max', effort: 'high' });
});

test('链式配置 gemini：不支持思考强度，只问模型', async () => {
  const root = await tmp('cfg-gemini');
  const { log } = collector();
  const prompt = scripted(['2']);
  const result = await assignRoleWithChain({ root, prompt, log, role: 'qa', agentId: 'gemini', authFn: authOk });
  assert.equal(result.saved, true);
  assert.deepEqual(result.picked, { model: 'gemini-2.5-pro', effort: null });
  // 只消耗了一个回答，证明没有进入思考强度步骤
  assert.equal(await prompt.line(), null);
});

test('链式配置：选择“其他”后手动输入模型名', async () => {
  const root = await tmp('cfg-custom');
  const { log } = collector();
  // codex 有 2 个模型，“其他”是第 4 项；先输入非法名，再输入合法名，思考强度选默认
  const result = await assignRoleWithChain({
    root,
    prompt: scripted(['4', 'bad name', 'gpt-5', '1']),
    log,
    role: 'backend-dev',
    agentId: 'codex',
    authFn: authOk,
  });
  assert.equal(result.saved, true);
  assert.equal(result.picked.model, 'gpt-5');
  assert.equal(result.picked.effort, null);
});

test('链式配置：deepseek 思考强度 2 = off（关闭思考）', async () => {
  const root = await tmp('cfg-deepseek');
  const { log } = collector();
  const result = await assignRoleWithChain({
    root,
    prompt: scripted(['1', '2']),
    log,
    role: 'pm',
    agentId: 'deepseek',
    authFn: authOk,
  });
  assert.equal(result.picked.effort, 'off');
});

test('链式配置：中途输入结束则取消，配置文件不被写入', async () => {
  const root = await tmp('cfg-eof');
  const { log } = collector();
  const result = await assignRoleWithChain({
    root,
    prompt: scripted(['2']),
    log,
    role: 'backend-dev',
    agentId: 'codex',
    authFn: authOk,
  });
  assert.equal(result.saved, false);
  await assert.rejects(readFile(join(root, 'team', 'assignments.json'), 'utf8'), 'ENOENT');
});

test('链式配置：认证未完成则直接返回，不进入模型选择', async () => {
  const root = await tmp('cfg-noauth');
  const { log } = collector();
  const prompt = scripted(['2', '4']);
  const result = await assignRoleWithChain({
    root,
    prompt,
    log,
    role: 'backend-dev',
    agentId: 'codex',
    authFn: async () => false,
  });
  assert.equal(result.saved, false);
  assert.match(result.reason, /未完成认证/);
  assert.equal(await prompt.line(), '2', '模型步骤不应消耗回答');
});

test('链式配置：preset 中的模型与强度跳过对应步骤', async () => {
  const root = await tmp('cfg-preset');
  const { log } = collector();
  const result = await assignRoleWithChain({
    root,
    prompt: scripted([]),
    log,
    role: 'backend-dev',
    agentId: 'codex',
    preset: { model: null, effort: 'high' },
    authFn: authOk,
  });
  assert.equal(result.saved, true);
  assert.deepEqual(result.picked, { model: null, effort: 'high' });
});

test('全部角色链式配置：同一个 agent 写入所有角色', async () => {
  const root = await tmp('cfg-all');
  const { log } = collector();
  const result = await assignAllWithChain({
    root,
    prompt: scripted(['1']),
    log,
    agentId: 'gemini',
    authFn: authOk,
  });
  assert.equal(result.saved, true);
  const saved = await readAssignments(root);
  assert.equal(saved.assignments['frontend-dev'].agent, 'gemini');
  assert.equal(saved.assignments['qa'].agent, 'gemini');
});

test('changeModelWithChain：只改模型，agent 与强度保留', async () => {
  const root = await tmp('cfg-change-model');
  await assignRole(root, 'backend-dev', 'codex', null, 'high');
  const { log } = collector();
  // 模型第 3 项 = gpt-6.1-sol；思考强度第 4 项 = high。两步都会重新询问。
  const result = await changeModelWithChain({ root, prompt: scripted(['3', '4']), log, role: 'backend-dev' });
  assert.equal(result.saved, true);
  assert.deepEqual(result.picked, { model: 'gpt-6.1-sol', effort: 'high' });
  const saved = await readAssignments(root);
  assert.deepEqual(saved.assignments['backend-dev'], { agent: 'codex', model: 'gpt-6.1-sol', effort: 'high' });
});

test('changeEffortWithChain：gemini 不支持思考强度时给出说明且不改动', async () => {
  const root = await tmp('cfg-change-effort');
  await assignRole(root, 'qa', 'gemini');
  const { log } = collector();
  const result = await changeEffortWithChain({ root, prompt: scripted(['1']), log, role: 'qa' });
  assert.equal(result.saved, false);
  assert.match(result.reason, /不支持按次设置思考强度/);
  const saved = await readAssignments(root);
  assert.deepEqual(saved.assignments.qa, { agent: 'gemini', model: null, effort: null });
});
