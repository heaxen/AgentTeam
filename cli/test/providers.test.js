import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from '../src/providers/index.js';
import { apiProvider } from '../src/providers/api.js';

test('未知模式直接报错', () => {
  assert.throws(() => getProvider('bogus'), /未知模式/);
});

test('API 模式缺 key 时给出明确提示', async () => {
  await assert.rejects(apiProvider.run({ prompt: 'hi', model: 'x', apiKey: '' }), /需要 key/);
});
