import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventLog } from '@agentteam/core/store/events';
import { fakeSession, start } from './helpers.js';

// 读出 count 条事件后断开连接。
async function collect(res, count, timeoutMs = 3000) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const deadline = Date.now() + timeoutMs;
  while (events.length < count) {
    if (Date.now() > deadline) throw new Error(`只收到 ${events.length} 条事件`);
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = block.split('\n').find((line) => line.startsWith('data: '));
      if (data) events.push(JSON.parse(data.slice('data: '.length)));
    }
  }
  await reader.cancel();
  return events;
}

async function logWithEvents(count) {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-sse-'));
  const log = await createEventLog(root);
  for (let i = 1; i <= count; i++) log.emit('message', { from: 'user', text: `第 ${i} 条` });
  return log;
}

test('after=0：补发全部历史事件', { timeout: 10000 }, async () => {
  const log = await logWithEvents(3);
  const server = await start(fakeSession({ log }));
  try {
    const res = await fetch(`${server.base}/api/events?after=0`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const events = await collect(res, 3);
    assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
    assert.equal(events[0].text, '第 1 条');
  } finally {
    await server.close();
  }
});

test('after=2：只补发 seq 大于 2 的事件', { timeout: 10000 }, async () => {
  const log = await logWithEvents(3);
  const server = await start(fakeSession({ log }));
  try {
    const events = await collect(await fetch(`${server.base}/api/events?after=2`), 1);
    assert.deepEqual(events.map((e) => e.seq), [3]);
  } finally {
    await server.close();
  }
});

test('没有 after 参数时用 Last-Event-ID 续传', { timeout: 10000 }, async () => {
  const log = await logWithEvents(3);
  const server = await start(fakeSession({ log }));
  try {
    const res = await fetch(`${server.base}/api/events`, { headers: { 'Last-Event-ID': '1' } });
    assert.deepEqual((await collect(res, 2)).map((e) => e.seq), [2, 3]);
  } finally {
    await server.close();
  }
});

test('连接之后新发出的事件会实时推送，且与历史事件之间没有空洞和重复', { timeout: 10000 }, async () => {
  const log = await logWithEvents(2);
  const server = await start(fakeSession({ log }));
  try {
    const res = await fetch(`${server.base}/api/events?after=1`);
    log.emit('message', { from: 'team', text: '实时的一条' });
    log.emit('stage.changed', { stage: 'arch_review' });
    const events = await collect(res, 3);
    assert.deepEqual(events.map((e) => e.seq), [2, 3, 4]);
    assert.equal(events[2].type, 'stage.changed');
  } finally {
    await server.close();
  }
});

test('after 不是非负整数时返回 400', async () => {
  const log = await logWithEvents(1);
  const server = await start(fakeSession({ log }));
  try {
    for (const bad of ['abc', '-1', '1.5', '']) {
      const res = await fetch(`${server.base}/api/events?after=${bad}`);
      assert.equal(res.status, 400, `after=${bad}`);
    }
  } finally {
    await server.close();
  }
});

test('客户端断开后取消订阅', { timeout: 10000 }, async () => {
  const subscribers = new Set();
  const log = {
    lastSeq: 0,
    after: () => [],
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
  const server = await start(fakeSession({ log }));
  try {
    const controller = new AbortController();
    const res = await fetch(`${server.base}/api/events?after=0`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.equal(subscribers.size, 1);
    controller.abort();
    const deadline = Date.now() + 3000;
    while (subscribers.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.equal(subscribers.size, 0, '断开后订阅应被取消，否则会泄漏');
  } finally {
    await server.close();
  }
});

test('长时间没有事件时发心跳注释', { timeout: 10000 }, async () => {
  const log = await logWithEvents(0);
  const server = await start(fakeSession({ log }), { heartbeatMs: 30 });
  try {
    const res = await fetch(`${server.base}/api/events?after=0`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3000;
    while (!text.includes(': ping') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    assert.ok(text.includes(': ping'), '应收到心跳注释');
  } finally {
    await server.close();
  }
});
