import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, BusyError } from '../src/session.js';
import { EVENTS_FILE } from '../src/store/events.js';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-session-'));
  await mkdir(join(root, 'team', 'tasks'), { recursive: true });
  return root;
}

// 假的派发：写出任务卡"交付"清单里的文件，并通过 onOutput 吐一段文字。
function fakeDispatch({ onCall, fail = [] } = {}) {
  return async ({ root, taskId, role, onOutput }) => {
    await onCall?.(role);
    onOutput?.(`${role} 工作中\n`);
    if (fail.includes(role)) return { ok: false, text: '', error: `${role} 模拟失败`, changed: [], log: null };
    const card = await readFile(join(root, 'team', 'tasks', `${taskId}.md`), 'utf8');
    const lines = card.split('\n');
    const outs = lines.slice(lines.indexOf('交付：') + 1).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    for (const out of outs) {
      const full = join(root, out);
      await mkdir(join(full, '..'), { recursive: true });
      const body = out.endsWith('-summary.md') ? '## 方案 A：Go + Vue\n\n## 方案 B：Node + React\n' : `# ${out}\n`;
      await writeFile(full, body, 'utf8');
    }
    return { ok: true, text: '', changed: outs, log: null };
  };
}

test('一次对话产生按顺序排列的结构化事件，并落盘', async () => {
  const root = await project();
  const session = await createSession({ root, dispatch: fakeDispatch() });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'arch_review');

  const events = session.log.after(0);
  assert.deepEqual(
    events.map((e) => e.type),
    [
      'message',
      'role.started', 'role.output', 'role.files', 'role.finished',
      'role.started', 'role.output', 'role.files', 'role.finished',
      'message',
      'stage.changed',
    ],
  );
  assert.deepEqual(events.filter((e) => e.type === 'role.started').map((e) => e.role), ['req-analyst', 'architect']);
  assert.equal(events[0].from, 'user');
  assert.equal(events[9].from, 'team');
  assert.equal(events[10].stage, 'arch_review');
  assert.equal(events[1].agent, 'claude', '没有分配时角色默认由 claude 执行');
  assert.equal(events[2].chunk, 'req-analyst 工作中\n');
  assert.deepEqual(events[3].files, ['docs/requirements/REQ-001.md']);

  await session.log.flush();
  const onDisk = (await readFile(join(root, EVENTS_FILE), 'utf8')).trim().split('\n');
  assert.equal(onDisk.length, events.length);
});

test('角色失败时发 role.failed，阶段变为 failed', async () => {
  const root = await project();
  const session = await createSession({ root, dispatch: fakeDispatch({ fail: ['req-analyst'] }) });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'failed');
  const failed = session.log.after(0).find((e) => e.type === 'role.failed');
  assert.equal(failed.role, 'req-analyst');
  assert.match(failed.error, /模拟失败/);
  assert.equal(session.log.after(0).at(-1).stage, 'failed');
});

test('同一时刻只允许一个运行：运行中再发消息抛 BusyError，结束后可以继续', async () => {
  const root = await project();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const session = await createSession({ root, dispatch: fakeDispatch({ onCall: () => gate }) });

  const first = session.send('做个登录功能');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await session.state()).running, true);
  await assert.rejects(session.send('再来一个'), BusyError);

  release();
  await first;
  const state = await session.state();
  assert.equal(state.running, false);
  assert.equal(state.stage, 'arch_review');
  assert.equal(state.lastSeq, session.log.lastSeq);
});

test('requestPause 让流程在当前角色结束后停下，且只影响本次运行', async () => {
  const root = await project();
  let session;
  session = await createSession({
    root,
    dispatch: fakeDispatch({
      onCall: (role) => {
        if (role === 'req-analyst') assert.equal(session.requestPause(), true);
      },
    }),
  });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'paused');
  assert.deepEqual(
    session.log.after(0).filter((e) => e.type === 'role.started').map((e) => e.role),
    ['req-analyst'],
    '暂停后不应启动架构师',
  );

  // 回复"继续"是新的一次运行：上一次的暂停请求不能带过来。
  const next = await session.send('继续');
  assert.equal(next.stage, 'arch_review');
});

test('onOutput 只为非空字符串发事件，坏数据不会让派发失败', async () => {
  const root = await project();
  const inner = fakeDispatch();
  const session = await createSession({
    root,
    dispatch: async (args) => {
      args.onOutput(undefined);
      args.onOutput('');
      args.onOutput(42);
      args.onOutput('真正的输出\n');
      return inner({ ...args, onOutput: undefined });
    },
  });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'arch_review');
  const outputs = session.log.after(0).filter((e) => e.type === 'role.output');
  assert.equal(outputs.length, 2, '两个角色各一条');
  assert.ok(outputs.every((e) => e.chunk === '真正的输出\n'));
});

test('工作流本身出错时，send 抛出原始错误，并留下收尾事件，之后可再发消息', async () => {
  const root = await project();
  // 对话记录路径是目录，工作流写记录时必然失败。
  await mkdir(join(root, 'team', 'conversation.md'), { recursive: true });
  const session = await createSession({ root, dispatch: fakeDispatch() });

  await assert.rejects(session.send('做个登录功能'), (err) => !(err instanceof BusyError));
  const events = session.log.after(0);
  assert.equal(events.at(-2).type, 'message');
  assert.equal(events.at(-2).from, 'team');
  assert.match(events.at(-2).text, /^执行出错：/);
  assert.equal(events.at(-1).type, 'stage.changed');
  assert.equal((await session.state()).running, false);
});
