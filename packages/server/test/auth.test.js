import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeSession, start } from './helpers.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agentteam-auth-'));
  const credentialsFile = join(dir, 'credentials.json');
  const server = await start(fakeSession(), { credentialsFile });
  const post = (agent, body) =>
    fetch(`${server.base}/api/auth/${agent}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  return { server, credentialsFile, post };
}

test('GET /api/agents：列出 agent、可选模型与强度，不含任何凭证内容', async () => {
  const { server } = await setup();
  try {
    const res = await fetch(`${server.base}/api/agents`);
    assert.equal(res.status, 200);
    const agents = await res.json();
    const ids = agents.map((a) => a.id);
    assert.ok(ids.includes('claude') && ids.includes('deepseek'));
    const claude = agents.find((a) => a.id === 'claude');
    assert.ok(claude.models.length > 0);
    assert.ok(claude.efforts.includes('high'));
    assert.equal(typeof claude.authenticated, 'boolean');
    assert.deepEqual(Object.keys(claude).sort(), ['authenticated', 'efforts', 'id', 'kind', 'models', 'name']);
  } finally {
    await server.close();
  }
});

test('保存 API key：写入凭证文件，响应和 agent 列表都不回显 key', async () => {
  const { server, credentialsFile, post } = await setup();
  const secret = 'sk-test-0123456789abcdef';
  try {
    const res = await post('deepseek', { method: 'api', apiKey: `  ${secret}  ` });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { agent: 'deepseek', authenticated: true });
    assert.ok(!text.includes(secret));

    const saved = await readFile(credentialsFile, 'utf8');
    assert.ok(saved.includes(secret), 'key 应写入凭证文件');

    const listText = await (await fetch(`${server.base}/api/agents`)).text();
    assert.ok(!listText.includes(secret));
    const deepseek = JSON.parse(listText).find((a) => a.id === 'deepseek');
    assert.equal(deepseek.authenticated, true);
  } finally {
    await server.close();
  }
});

test('confirm：记录用户已在终端完成订阅登录', async () => {
  const { server, credentialsFile, post } = await setup();
  try {
    const res = await post('claude', { method: 'confirm' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { agent: 'claude', authenticated: true });
    assert.match(await readFile(credentialsFile, 'utf8'), /subscription/);
  } finally {
    await server.close();
  }
});

test('认证参数不合法时返回 4xx，且不写入凭证', async () => {
  const { server, credentialsFile, post } = await setup();
  try {
    assert.equal((await post('nope', { method: 'confirm' })).status, 404);
    assert.equal((await post('deepseek', { method: 'api' })).status, 400, '缺少 apiKey');
    assert.equal((await post('deepseek', { method: 'api', apiKey: 'sk a b' })).status, 400, '含空白');
    assert.equal((await post('deepseek', { method: 'api', apiKey: 'x'.repeat(513) })).status, 400, '过长');
    assert.equal((await post('deepseek', { method: 'confirm' })).status, 400, '只能用 API key 的 agent 不能 confirm');
    assert.equal((await post('claude', { method: 'other' })).status, 400);
    assert.equal((await post('claude', {})).status, 400);
    await assert.rejects(readFile(credentialsFile, 'utf8'), { code: 'ENOENT' }, '失败的请求不能创建凭证文件');
  } finally {
    await server.close();
  }
});
