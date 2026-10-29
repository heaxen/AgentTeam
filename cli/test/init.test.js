import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/init.js';
import { createEmitter } from '../src/events.js';

const silent = createEmitter({ json: false });

test('init 创建目录和模板文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-'));
  const { created, skipped } = await initProject(root, silent);
  assert.ok(created.includes('AGENTS.md'));
  assert.ok(created.includes('team/roles/architect.md'));
  assert.equal(skipped.length, 0);
});

test('init 不覆盖用户已改过的文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-'));
  await initProject(root, silent);
  await writeFile(join(root, 'AGENTS.md'), '用户自己的版本', 'utf8');
  const { skipped } = await initProject(root, silent);
  assert.ok(skipped.includes('AGENTS.md'));
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), '用户自己的版本');
});
