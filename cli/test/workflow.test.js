import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMessage, loadState, parseOptions, planOptions, findStackFile } from '../src/workflow.js';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-flow-'));
  await mkdir(join(root, 'team', 'tasks'), { recursive: true });
  await mkdir(join(root, 'stacks'), { recursive: true });
  await writeFile(join(root, 'stacks', 'demo.md'), '# demo\n', 'utf8');
  return root;
}

// 假的派发：读取任务卡的"交付"清单，写出对应文件。architect 的摘要写入两个方案。
// failOnce：指定某个角色第一次执行失败，用来测试重试。
function fakeDispatch({ failOnce = [] } = {}) {
  const calls = [];
  const fails = new Set(failOnce);
  const dispatch = async ({ root, taskId, role }) => {
    calls.push(role);
    if (fails.has(role)) {
      fails.delete(role);
      return { ok: false, text: '', error: `${role} 模拟失败`, log: 'team/runs/fake.md' };
    }
    const card = await readFile(join(root, 'team', 'tasks', `${taskId}.md`), 'utf8');
    const lines = card.split('\n');
    const outs = lines.slice(lines.indexOf('交付：') + 1).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    for (const out of outs) {
      const full = join(root, out);
      await mkdir(join(full, '..'), { recursive: true });
      const body = out.endsWith('-summary.md')
        ? '# 摘要\n\n## 方案 A：Go + Vue\n\n## 方案 B：Node + React\n'
        : `# ${out}\n`;
      await writeFile(full, body, 'utf8');
    }
    return { ok: true, text: '', changed: outs, log: 'team/runs/fake.md' };
  };
  return { dispatch, calls };
}

async function say(root, deps, text) {
  return handleMessage({ root, text, deps });
}

test('解析架构摘要中的方案字母与标题', async () => {
  assert.deepEqual(parseOptions('## 方案 A：x\n\n## 方案 B：y\n'), ['A', 'B']);
  assert.deepEqual(parseOptions('没有方案标题'), []);

  const root = await project();
  await say(root, { dispatch: fakeDispatch().dispatch }, '做一个报表');
  assert.deepEqual(await planOptions(root, 'ARCH-001'), [
    { letter: 'A', title: 'Go + Vue' },
    { letter: 'B', title: 'Node + React' },
  ]);
});

test('完整主线：需求 → 方案（自动列出）→ 选 B → 执行后端、前端、测试 → 交付报告', async () => {
  const root = await project();
  const fake = fakeDispatch();
  const deps = { dispatch: fake.dispatch };

  const r1 = await say(root, deps, '做一个订单导出功能');
  assert.equal(r1.stage, 'arch_review', '需求分析完成后直接进入方案，不再等待确认');
  assert.match(r1.text, /A\. Go \+ Vue/);
  assert.match(r1.text, /B\. Node \+ React/);

  const r2 = await say(root, deps, '2');
  assert.equal(r2.stage, 'delivered');
  assert.deepEqual(fake.calls, ['req-analyst', 'architect', 'backend-dev', 'frontend-dev', 'qa', 'pm']);

  const delivery = await readFile(join(root, 'docs', 'delivery', 'DELIVERY-001.md'), 'utf8');
  assert.match(delivery, /DELIVERY-001/);
  const state = await loadState(root);
  assert.equal(state.choice, 'B');
  assert.deepEqual(state.buildDone, ['backend-dev', 'frontend-dev', 'qa']);
});

test('只有一个方案也直接列出，可以选择或讨论', async () => {
  const root = await project();
  const fake = fakeDispatch();
  const deps = {
    dispatch: async (args) => {
      const result = await fake.dispatch(args);
      if (args.role === 'architect') {
        await writeFile(join(root, 'docs', 'architecture', 'ARCH-001-summary.md'), '## 方案 A：Go + Vue\n', 'utf8');
      }
      return result;
    },
  };
  const r = await say(root, deps, '做一个报表');
  assert.equal(r.stage, 'arch_review');
  assert.match(r.text, /A\. Go \+ Vue/);
  assert.doesNotMatch(r.text, /B\./);
});

test('方案阶段输入讨论意见：架构师重新设计，需求不重新分析，也不当作新需求', async () => {
  const root = await project();
  const fake = fakeDispatch();
  const deps = { dispatch: fake.dispatch };
  await say(root, deps, '做一个登录页');
  const r = await say(root, deps, '还要支持微信登录');
  assert.equal(r.stage, 'arch_review');
  assert.deepEqual(fake.calls, ['req-analyst', 'architect', 'architect']);
  assert.equal((await loadState(root)).request, '做一个登录页');
});

test('方案阶段可以用字母或序号选择；不存在的方案给出可选项，阶段不变', async () => {
  const root = await project();
  const deps = { dispatch: fakeDispatch().dispatch };
  await say(root, deps, '做一个报表');
  const bad = await say(root, deps, 'C');
  assert.equal(bad.stage, 'arch_review');
  assert.match(bad.text, /可选：A、B/);
  const outOfRange = await say(root, deps, '9');
  assert.equal(outOfRange.stage, 'arch_review');
  assert.match(outOfRange.text, /1 到 2/);
});

test('缺少技术栈档案：执行前停止，并说明怎么补', async () => {
  const root = await project();
  await rm(join(root, 'stacks', 'demo.md'));
  const fake = fakeDispatch();
  const deps = { dispatch: fake.dispatch };
  await say(root, deps, '做一个报表');
  const r = await say(root, deps, 'A');
  assert.equal(r.stage, 'failed');
  assert.match(r.text, /缺少技术栈档案/);
  assert.equal(fake.calls.includes('backend-dev'), false, '没有档案时不得派发实现角色');
});

test('某个角色失败后，回复"重试"从失败处继续，已完成的角色不重做', async () => {
  const root = await project();
  const fake = fakeDispatch({ failOnce: ['frontend-dev'] });
  const deps = { dispatch: fake.dispatch };
  await say(root, deps, '做一个报表');
  const failed = await say(root, deps, 'A');
  assert.equal(failed.stage, 'failed');
  assert.match(failed.text, /前端开发执行失败/);

  const retried = await say(root, deps, '重试');
  assert.equal(retried.stage, 'delivered');
  assert.deepEqual(fake.calls.filter((r) => r === 'backend-dev'), ['backend-dev'], '后端不应重做');
  assert.equal(fake.calls.filter((r) => r === 'frontend-dev').length, 2);
});

test('派发直接抛出异常（如未认证）：转为失败步骤，不结束对话，修正后可重试', async () => {
  const root = await project();
  const fake = fakeDispatch();
  let broken = false;
  const deps = {
    dispatch: async (args) => {
      if (broken && args.role === 'architect') throw new Error('Claude Code 尚未认证');
      return fake.dispatch(args);
    },
  };
  const planned = await say(root, deps, '做一个报表');
  assert.equal(planned.stage, 'arch_review');
  broken = true;
  const r = await say(root, deps, '我想换个思路');
  assert.equal(r.stage, 'failed');
  assert.match(r.text, /架构师无法启动：Claude Code 尚未认证/);
  broken = false;
  const retried = await say(root, deps, '重试');
  assert.equal(retried.stage, 'arch_review');
});

test('取消后，直接输入的文字不会开始新需求；输入"新需求"后的下一条才是', async () => {
  const root = await project();
  const fake = fakeDispatch();
  const deps = { dispatch: fake.dispatch };
  await say(root, deps, '做一个报表');

  const cancelled = await say(root, deps, '取消');
  assert.equal(cancelled.stage, 'closed');
  const callsAfterCancel = fake.calls.length;

  const ignored = await say(root, deps, '做一个设置页');
  assert.equal(ignored.stage, 'closed', '取消后直接输入不算新需求');
  assert.equal(fake.calls.length, callsAfterCancel, '不派发任何角色');

  const prompt = await say(root, deps, 'new');
  assert.match(prompt.text, /请输入新需求/);
  const started = await say(root, deps, '做一个设置页');
  assert.equal(started.stage, 'arch_review');
  assert.equal((await loadState(root)).request, '做一个设置页');
});

test('交付后直接输入不会开始新需求，需先输入"新需求"', async () => {
  const root = await project();
  const deps = { dispatch: fakeDispatch().dispatch };
  await say(root, deps, '做一个报表');
  await say(root, deps, 'A');

  const blocked = await say(root, deps, '做一个设置页');
  assert.equal(blocked.stage, 'delivered');
  assert.match(blocked.text, /已交付/);

  await say(root, deps, '新需求');
  const next = await say(root, deps, '做一个设置页');
  assert.equal(next.stage, 'arch_review');
  assert.equal((await loadState(root)).request, '做一个设置页');
});

test('失败后输入"继续"即从失败处重试，原需求保留', async () => {
  const root = await project();
  const deps = { dispatch: fakeDispatch({ failOnce: ['req-analyst'] }).dispatch };
  const failed = await say(root, deps, '做一个报表');
  assert.equal(failed.stage, 'failed');

  const retried = await say(root, deps, '继续');
  assert.equal(retried.stage, 'arch_review');
  assert.equal((await loadState(root)).request, '做一个报表');
});

test('失败后输入其他内容不会丢掉原需求；只有"取消"才清空', async () => {
  const root = await project();
  const deps = { dispatch: fakeDispatch({ failOnce: ['req-analyst'] }).dispatch };
  await say(root, deps, '做一个报表');

  const other = await say(root, deps, '你直接开始做');
  assert.equal(other.stage, 'failed');
  assert.match(other.text, /做一个报表/);
  assert.equal((await loadState(root)).request, '做一个报表');

  const cancelled = await say(root, deps, '取消');
  assert.equal(cancelled.stage, 'closed');
  assert.equal((await loadState(root)).request, null);
});

test('没有进行中的需求时输入"取消"：说明即可，不改变状态', async () => {
  const root = await project();
  const r = await say(root, { dispatch: fakeDispatch().dispatch }, '取消');
  assert.equal(r.stage, 'idle');
  assert.match(r.text, /没有进行中的需求/);
});

test('对话记录落盘：用户与团队的每条消息都写入 team/conversation.md', async () => {
  const root = await project();
  await say(root, { dispatch: fakeDispatch().dispatch }, '做一个报表');
  const log = await readFile(join(root, 'team', 'conversation.md'), 'utf8');
  assert.match(log, /\*\*你\*\*/);
  assert.match(log, /做一个报表/);
  assert.match(log, /\*\*PM\*\*/);
});

test('findStackFile 忽略模板，只认项目档案', async () => {
  const root = await project();
  await writeFile(join(root, 'stacks', 'demo.md'), 'x', 'utf8');
  await writeFile(join(root, 'stacks', '_template.md'), 'x', 'utf8');
  assert.equal(await findStackFile(root), 'stacks/demo.md');
  assert.ok((await readdir(join(root, 'stacks'))).length === 2);
});
