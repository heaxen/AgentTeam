import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventLog, EVENTS_FILE } from '../src/store/events.js';

async function project() {
  return mkdtemp(join(tmpdir(), 'agentteam-events-'));
}

test('事件序号从 1 递增，并按行落盘', async () => {
  const root = await project();
  const log = await createEventLog(root);
  log.emit('role.started', { role: 'qa', agent: 'claude' });
  log.emit('role.finished', { role: 'qa' });
  await log.flush();

  assert.equal(log.lastSeq, 2);
  const lines = (await readFile(join(root, EVENTS_FILE), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.seq), [1, 2]);
  assert.equal(lines[0].type, 'role.started');
});

test('重新打开后接着上次的序号', async () => {
  const root = await project();
  const first = await createEventLog(root);
  first.emit('role.finished', { role: 'qa' });
  await first.flush();

  const second = await createEventLog(root);
  assert.equal(second.lastSeq, 1);
  const event = second.emit('role.finished', { role: 'qa' });
  assert.equal(event.seq, 2);
  assert.deepEqual(second.after(0).map((e) => e.seq), [1, 2]);
});

test('after 只返回序号更大的事件', async () => {
  const log = await createEventLog(await project());
  for (let i = 0; i < 3; i++) log.emit('role.output', { role: 'qa', chunk: String(i) });
  assert.deepEqual(log.after(1).map((e) => e.chunk), ['1', '2']);
  assert.deepEqual(log.after(3), []);
});

test('订阅者收到新事件，取消订阅后不再收到', async () => {
  const log = await createEventLog(await project());
  const seen = [];
  const off = log.subscribe((e) => seen.push(e.seq));
  log.emit('role.finished', { role: 'qa' });
  off();
  log.emit('role.finished', { role: 'qa' });
  assert.deepEqual(seen, [1]);
});

test('崩溃时可能留下写了一半的最后一行，读取时跳过它', async () => {
  const root = await project();
  await mkdir(join(root, 'team'), { recursive: true });
  const good = JSON.stringify({ v: 1, seq: 1, time: '2026-11-02T00:00:00.000Z', type: 'role.finished', role: 'qa' });
  await writeFile(join(root, EVENTS_FILE), `${good}\n{"v":1,"seq":2,"ti`, 'utf8');

  const log = await createEventLog(root);
  assert.equal(log.lastSeq, 1);
  assert.equal(log.emit('role.finished', { role: 'qa' }).seq, 2);
  await log.flush();

  const reopened = await createEventLog(root);
  assert.deepEqual(reopened.after(0).map((e) => e.seq), [1, 2]);
});

test('读取时跳过能解析但不是事件的行', async () => {
  const root = await project();
  await mkdir(join(root, 'team'), { recursive: true });
  const good = JSON.stringify({ v: 1, seq: 1, time: '2026-11-02T00:00:00.000Z', type: 'role.finished', role: 'qa' });
  await writeFile(join(root, EVENTS_FILE), `null\n42\n{"a":1}\n${good}\n`, 'utf8');
  const log = await createEventLog(root);
  assert.deepEqual(log.after(0).map((e) => e.seq), [1]);
  assert.equal(log.lastSeq, 1);
});

test('订阅者抛错不影响 emit 和其他订阅者', async () => {
  const log = await createEventLog(await project());
  const seen = [];
  log.subscribe(() => {
    throw new Error('boom');
  });
  log.subscribe((e) => seen.push(e.seq));
  assert.doesNotThrow(() => log.emit('role.finished', { role: 'qa' }));
  assert.deepEqual(seen, [1]);
});

test('非法事件在 emit 时直接抛错，不占用序号', async () => {
  const log = await createEventLog(await project());
  assert.throws(() => log.emit('role.failed', { role: 'qa' }), /缺少字段 error/);
  assert.equal(log.lastSeq, 0);
});
