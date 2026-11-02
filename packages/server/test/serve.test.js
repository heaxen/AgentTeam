import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/serve.js';
import { rawRequest } from './helpers.js';

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'agentteam-serve-'));
}

test('startServer：真实 Session 的状态可读，事件日志落在项目的 team/events.jsonl', async () => {
  const root = await tempRoot();
  const server = await startServer({ root, port: 0 });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const state = await (await fetch(`${server.url}/api/state`)).json();
    assert.equal(state.running, false);
    assert.equal(state.lastSeq, 0);
    const roles = await (await fetch(`${server.url}/api/roles`)).json();
    assert.equal(roles.qa.agent, 'claude');
  } finally {
    await server.close();
  }
});

test('startServer：拒绝监听非本机地址（访问令牌做完之前不开放远程）', async () => {
  const root = await tempRoot();
  await assert.rejects(startServer({ root, port: 0, host: '0.0.0.0' }), /访问令牌/);
  await assert.rejects(startServer({ root, port: 0, host: '192.168.1.5' }), /访问令牌/);
});

test('startServer：端口被占用时给出明确错误', async () => {
  const root = await tempRoot();
  const first = await startServer({ root, port: 0 });
  try {
    await assert.rejects(startServer({ root: await tempRoot(), port: first.port }), /已被占用/);
  } finally {
    await first.close();
  }
});

test('startServer：Host 不是本机地址时返回 403', async () => {
  const server = await startServer({ root: await tempRoot(), port: 0 });
  try {
    const res = await rawRequest({ port: server.port, path: '/api/state', headers: { Host: 'evil.example' } });
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test('静态托管：文件、单页回退、缺失资源与越界路径', async () => {
  const dir = await tempRoot();
  const webDir = join(dir, 'web');
  await mkdir(join(webDir, 'assets'), { recursive: true });
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>指挥台</title>', 'utf8');
  await writeFile(join(webDir, 'assets', 'app.js'), 'console.log(1)', 'utf8');
  await writeFile(join(dir, 'secret.txt'), '不该被读到', 'utf8');

  const server = await startServer({ root: await tempRoot(), port: 0, webDir });
  try {
    const index = await rawRequest({ port: server.port, path: '/', headers: {} });
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.match(index.text, /指挥台/);

    const js = await rawRequest({ port: server.port, path: '/assets/app.js', headers: {} });
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /javascript/);

    const spa = await rawRequest({ port: server.port, path: '/pipeline/role-1', headers: {} });
    assert.equal(spa.status, 200);
    assert.match(spa.text, /指挥台/, '不带扩展名的未知路径回到 index.html');

    assert.equal((await rawRequest({ port: server.port, path: '/missing.js', headers: {} })).status, 404);
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const res = await rawRequest({ port: server.port, path, headers: {} });
      assert.ok(!res.text.includes('不该被读到'), `${path} 不能读到 web 目录之外的文件`);
    }
    // 静态托管不能盖住接口。
    assert.equal((await rawRequest({ port: server.port, path: '/api/nope', headers: {} })).status, 404);
    assert.equal((await rawRequest({ port: server.port, path: '/api/state', headers: {} })).status, 200);
  } finally {
    await server.close();
  }
});
