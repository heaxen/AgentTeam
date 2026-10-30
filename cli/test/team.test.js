import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignRole, assignAll, resolveAssignments, ROLES, DEFAULT_AGENT } from '../src/assign.js';
import {
  loadCredentials,
  saveAgentCredential,
  isAuthenticated,
} from '../src/credentials.js';
import { keyFromEnv } from '../src/auth.js';
import { getAgent } from '../src/agents.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'agentteam-'));
}

test('未分配的角色默认由 claude 执行', async () => {
  const root = await tempDir();
  const resolved = await resolveAssignments(root);
  for (const role of ROLES) assert.equal(resolved[role], DEFAULT_AGENT);
});

test('指定单个角色后写入 team/assignments.json，其他角色不变', async () => {
  const root = await tempDir();
  await assignRole(root, 'frontend-dev', 'codex');
  const resolved = await resolveAssignments(root);
  assert.equal(resolved['frontend-dev'], 'codex');
  assert.equal(resolved['backend-dev'], DEFAULT_AGENT);
  const raw = JSON.parse(await readFile(join(root, 'team', 'assignments.json'), 'utf8'));
  assert.equal(raw.assignments['frontend-dev'], 'codex');
});

test('未知角色或未知 agent 直接报错，且不写文件', async () => {
  const root = await tempDir();
  await assert.rejects(assignRole(root, 'boss', 'claude'), /未知角色/);
  await assert.rejects(assignRole(root, 'qa', 'bogus'), /未知 agent/);
  await assert.rejects(stat(join(root, 'team', 'assignments.json')));
});

test('--all 把全部角色指定为同一个 agent', async () => {
  const root = await tempDir();
  await assignAll(root, 'pi');
  const resolved = await resolveAssignments(root);
  for (const role of ROLES) assert.equal(resolved[role], 'pi');
});

test('凭证保存在指定文件，且只合并目标 agent 的字段', async () => {
  const root = await tempDir();
  const file = join(root, 'credentials.json');
  await saveAgentCredential('deepseek', { apiKey: 'sk-test' }, file);
  await saveAgentCredential('claude', { loggedInAt: '2026-10-29T00:00:00.000Z' }, file);
  const data = await loadCredentials(file);
  assert.equal(data.agents.deepseek.apiKey, 'sk-test');
  assert.equal(data.agents.claude.loggedInAt, '2026-10-29T00:00:00.000Z');
});

test('认证判断：环境变量、本机凭证、登录记录任一即可', () => {
  const deepseek = getAgent('deepseek');
  assert.equal(isAuthenticated(deepseek, {}, {}), false);
  assert.equal(isAuthenticated(deepseek, {}, { DEEPSEEK_API_KEY: 'x' }), true);
  assert.equal(isAuthenticated(deepseek, { apiKey: 'x' }, {}), true);
  const claude = getAgent('claude');
  assert.equal(isAuthenticated(claude, { loggedInAt: 'now' }, {}), true);
  assert.equal(isAuthenticated(claude, {}, {}), false);
});

test('--from-env 只读取 agent 声明的环境变量名', () => {
  const deepseek = getAgent('deepseek');
  assert.equal(keyFromEnv(deepseek, {}), null);
  assert.deepEqual(keyFromEnv(deepseek, { DEEPSEEK_API_KEY: 'sk-1' }), {
    name: 'DEEPSEEK_API_KEY',
    value: 'sk-1',
  });
});
