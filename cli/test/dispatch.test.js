import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignRole } from '../src/assign.js';
import { getAgent } from '../src/agents.js';
import {
  assertTaskId,
  assertRole,
  buildPrompt,
  roleFile,
  checkCredential,
  effectiveCredential,
  snapshot,
  diffSnapshots,
  dispatchTask,
} from '../src/dispatch.js';

async function projectWithTask() {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-dispatch-'));
  await mkdir(join(root, 'team', 'tasks'), { recursive: true });
  await writeFile(join(root, 'team', 'tasks', 'T-001.md'), '# T-001\n目标：登录接口\n', 'utf8');
  return root;
}

test('任务号与角色必须合法', () => {
  assert.doesNotThrow(() => assertTaskId('T-001'));
  assert.throws(() => assertTaskId('001'), /T-NNN/);
  assert.throws(() => assertTaskId(undefined), /T-NNN/);
  assert.doesNotThrow(() => assertRole('backend-dev'));
  assert.throws(() => assertRole('boss'), /未知角色/);
});

test('提示词包含角色、任务卡、说明书与 7 字段回传要求', () => {
  const prompt = buildPrompt({
    role: 'backend-dev',
    taskId: 'T-001',
    taskText: '目标：登录接口',
    roleText: '后端说明书正文',
  });
  assert.match(prompt, /【backend-dev】/);
  assert.match(prompt, /目标：登录接口/);
  assert.match(prompt, /后端说明书正文/);
  assert.match(prompt, /【改动文件】/);
  assert.match(prompt, /AGENTS\.md/);
  assert.doesNotMatch(prompt, /team[\\/]roles/, '说明书随 CLI 发布，不从项目里读取');
});

test('角色说明书从 CLI 发布目录读取，项目里不需要 team/roles', () => {
  assert.match(roleFile('backend-dev'), /templates[\\/]prompts[\\/]backend-dev\.md$/);
});

test('认证检查：未认证、缺 key 时直接拒绝', () => {
  const claude = getAgent('claude');
  assert.throws(() => checkCredential(claude, effectiveCredential({})), /尚未认证/);
  assert.throws(() => checkCredential(getAgent('gemini'), { method: 'api' }), /缺少 key/);
  assert.doesNotThrow(() => checkCredential(claude, { method: 'subscription', loggedInAt: 'now' }));
});

test('0.4.0 的旧凭证没有 method 字段，按已有字段推断', () => {
  assert.equal(effectiveCredential({ loggedInAt: 'now' }).method, 'subscription');
  assert.equal(effectiveCredential({ apiKey: 'k' }).method, 'api');
  assert.equal(effectiveCredential({ method: 'api', loggedInAt: 'now' }).method, 'api');
});

test('派发前校验：缺任务卡、未接入的 agent、未认证，都在启动 agent 之前报错', async () => {
  const root = await projectWithTask();

  await assert.rejects(
    dispatchTask({ root, taskId: 'T-999', role: 'backend-dev' }),
    /任务卡 team\/tasks\/T-999\.md 不存在/,
  );

  await assignRole(root, 'backend-dev', 'aider');
  await assert.rejects(
    dispatchTask({ root, taskId: 'T-001', role: 'backend-dev' }),
    /尚未接入执行适配器/,
  );

  await assignRole(root, 'backend-dev', 'claude');
  // 指向一个不存在的凭证文件：应在认证检查处停止，绝不会去启动真实的 claude
  await assert.rejects(
    dispatchTask({ root, taskId: 'T-001', role: 'backend-dev', credentialsFile: join(root, 'none.json') }),
    /尚未认证/,
  );

  // 没有写任何运行记录
  const runs = await readdir(join(root, 'team', 'runs')).catch(() => []);
  assert.equal(runs.length, 0);
});

test('文件快照：能识别新增、修改，忽略 team/runs 与 node_modules', async () => {
  const root = await projectWithTask();
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'x.js'), 'x', 'utf8');
  const before = await snapshot(root);
  assert.equal([...before.keys()].some((p) => p.startsWith('node_modules')), false);

  await writeFile(join(root, 'team', 'tasks', 'T-001.md'), '改过了，长度变了', 'utf8');
  await writeFile(join(root, 'src.js'), 'new', 'utf8');
  await mkdir(join(root, 'team', 'runs'), { recursive: true });
  await writeFile(join(root, 'team', 'runs', 'log.md'), 'log', 'utf8');

  const after = await snapshot(root);
  assert.deepEqual(diffSnapshots(before, after), ['src.js', 'team/tasks/T-001.md']);
});
