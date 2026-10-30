import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from '../src/providers/index.js';
import { apiProvider } from '../src/providers/api.js';

test('未知模式直接报错', () => {
  assert.throws(() => getProvider('bogus'), /未知模式/);
});

test('agent 注册表包含 pi，且已核对命令名与安装包', async () => {
  const { getAgent } = await import('../src/agents.js');
  const pi = getAgent('pi');
  assert.equal(pi.command, 'pi');
  assert.equal(pi.verified, true);
  assert.match(pi.install, /@earendil-works\/pi-coding-agent/);
});

test('所有注册的 agent 都已核对，且 CLI 类条目带命令名', async () => {
  const { AGENTS } = await import('../src/agents.js');
  for (const a of AGENTS) {
    assert.equal(a.verified, true, a.id);
    if (a.kind === 'cli') assert.ok(a.command, a.id);
  }
});

test('API 模式缺 key 时给出明确提示', async () => {
  await assert.rejects(apiProvider.run({ prompt: 'hi', model: 'x', apiKey: '' }), /需要 key/);
});
