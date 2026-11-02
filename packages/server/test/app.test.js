import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSession, start, rawRequest } from './helpers.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function post(base, path, body) {
  return fetch(`${base}${path}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body ?? {}) });
}

test('GET /api/state 返回 Session 的状态', async () => {
  const server = await start(fakeSession());
  try {
    const res = await fetch(`${server.base}/api/state`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { stage: 'idle', running: false, lastSeq: 0 });
  } finally {
    await server.close();
  }
});

test('POST /api/message：合法请求返回 202 并交给 Session', async () => {
  const session = fakeSession();
  const server = await start(session);
  try {
    const res = await post(server.base, '/api/message', { text: '  做一个登录页面  ' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: true });
    assert.deepEqual(session.calls.send, ['做一个登录页面']);
  } finally {
    await server.close();
  }
});

test('POST /api/message：空文本、非法 JSON、过长文本、过大请求体都被拒绝', async () => {
  const session = fakeSession();
  const server = await start(session);
  try {
    assert.equal((await post(server.base, '/api/message', { text: '   ' })).status, 400);
    assert.equal((await post(server.base, '/api/message', {})).status, 400);
    const bad = await rawRequest({ port: server.port, method: 'POST', path: '/api/message', headers: JSON_HEADERS, body: '不是json' });
    assert.equal(bad.status, 400);
    assert.equal((await post(server.base, '/api/message', { text: 'x'.repeat(20001) })).status, 400);
    const huge = await rawRequest({
      port: server.port,
      method: 'POST',
      path: '/api/message',
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: 'x'.repeat(70 * 1024) }),
    });
    assert.equal(huge.status, 413);
    assert.deepEqual(session.calls.send, [], '被拒绝的请求不能到达 Session');
  } finally {
    await server.close();
  }
});

test('POST /api/message：已有流程在运行时返回 409，不调用 send', async () => {
  const session = fakeSession();
  session.setRunning(true);
  const server = await start(session);
  try {
    const res = await post(server.base, '/api/message', { text: '再来一个' });
    assert.equal(res.status, 409);
    assert.deepEqual(session.calls.send, []);
  } finally {
    await server.close();
  }
});

test('POST /api/message：send 之后的失败不会变成未处理的拒绝', async () => {
  const session = fakeSession({
    send: async () => {
      throw new Error('工作流出错');
    },
  });
  const server = await start(session);
  try {
    const res = await post(server.base, '/api/message', { text: '会失败的需求' });
    assert.equal(res.status, 202);
  } finally {
    await server.close();
  }
});

test('POST /api/pause 与 /api/cancel：运行中成功，空闲时 409', async () => {
  const session = fakeSession();
  const server = await start(session);
  try {
    assert.equal((await post(server.base, '/api/pause')).status, 409);
    assert.equal((await post(server.base, '/api/cancel')).status, 409);
    assert.equal(session.calls.pause, 0);

    session.setRunning(true);
    const paused = await post(server.base, '/api/pause');
    assert.equal(paused.status, 200);
    assert.deepEqual(await paused.json(), { first: true });
    const cancelled = await post(server.base, '/api/cancel');
    assert.equal(cancelled.status, 200);
    assert.deepEqual(await cancelled.json(), { cancelled: true });
    assert.equal(session.calls.cancel, 1);
  } finally {
    await server.close();
  }
});

test('GET /api/roles 返回五个角色的默认分配，PUT 修改后可读回', async () => {
  const server = await start(fakeSession());
  try {
    const before = await (await fetch(`${server.base}/api/roles`)).json();
    assert.deepEqual(Object.keys(before).sort(), ['architect', 'backend-dev', 'frontend-dev', 'qa', 'req-analyst']);
    assert.equal(before.architect.agent, 'claude');

    const res = await fetch(`${server.base}/api/roles`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ assignments: { architect: { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'high' } } }),
    });
    assert.equal(res.status, 200);
    const after = await res.json();
    assert.deepEqual(after.architect, { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'high' });
    assert.deepEqual((await (await fetch(`${server.base}/api/roles`)).json()).architect, after.architect);
  } finally {
    await server.close();
  }
});

test('PUT /api/roles：任何一项非法，整批都不写入', async () => {
  const server = await start(fakeSession());
  try {
    const res = await fetch(`${server.base}/api/roles`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        assignments: { architect: { agent: 'claude', model: 'claude-sonnet-5-5' }, 'no-such-role': { agent: 'claude' } },
      }),
    });
    assert.equal(res.status, 400);
    const unknownAgent = await fetch(`${server.base}/api/roles`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ assignments: { qa: { agent: 'nope' } } }),
    });
    assert.equal(unknownAgent.status, 400);
    const after = await (await fetch(`${server.base}/api/roles`)).json();
    assert.equal(after.architect.model, null, '前面合法的那一项也不能被写入');
  } finally {
    await server.close();
  }
});

test('PUT /api/roles：流程运行中返回 409', async () => {
  const session = fakeSession();
  session.setRunning(true);
  const server = await start(session);
  try {
    const res = await fetch(`${server.base}/api/roles`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ assignments: { qa: { agent: 'claude' } } }),
    });
    assert.equal(res.status, 409);
  } finally {
    await server.close();
  }
});

test('Host 不在白名单时返回 403（防止 DNS 重绑定）', async () => {
  const server = await start(fakeSession());
  try {
    const res = await rawRequest({ port: server.port, path: '/api/state', headers: { Host: 'evil.example' } });
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test('Origin 不是本机页面时返回 403，本机页面和没有 Origin 的请求放行', async () => {
  const session = fakeSession();
  const server = await start(session);
  try {
    const send = (origin) =>
      rawRequest({
        port: server.port,
        method: 'POST',
        path: '/api/message',
        headers: { ...JSON_HEADERS, ...(origin === undefined ? {} : { Origin: origin }) },
        body: JSON.stringify({ text: '需求' }),
      });
    assert.equal((await send('http://evil.example')).status, 403);
    assert.equal((await send('null')).status, 403);
    assert.equal((await send(`https://127.0.0.1:${server.port}`)).status, 403, '只认 http 的本机页面');
    assert.equal((await send(`http://127.0.0.1:${server.port}`)).status, 202);
    assert.equal((await send(`http://localhost:${server.port}`)).status, 202);
    assert.equal((await send(undefined)).status, 202);
    assert.equal(session.calls.send.length, 3, '被拒绝的请求不能到达 Session');
  } finally {
    await server.close();
  }
});

test('未知接口返回 404', async () => {
  const server = await start(fakeSession());
  try {
    assert.equal((await fetch(`${server.base}/api/nope`)).status, 404);
  } finally {
    await server.close();
  }
});

test('PUT /api/roles：读请求体期间有运行启动时返回 409', async () => {
  // 第一次检查（读体之前）看到空闲，之后的检查看到运行中。
  let checks = 0;
  const session = fakeSession({ isRunning: () => ++checks > 1 });
  const server = await start(session);
  try {
    const res = await fetch(`${server.base}/api/roles`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ assignments: { 'req-analyst': { agent: 'claude' } } }),
    });
    assert.equal(res.status, 409);
  } finally {
    await server.close();
  }
});
