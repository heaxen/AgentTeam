import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from '../src/args.js';
import { DEFAULT_PORT } from '../src/serve.js';

test('没有参数：当前目录、默认端口、不托管 web', () => {
  assert.deepEqual(parseArgs([]), { root: process.cwd(), port: DEFAULT_PORT, webDir: null });
});

test('--root、--port、--web', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentteam-args-'));
  assert.deepEqual(parseArgs(['--root', dir, '--port', '4400', '--web', dir]), {
    root: resolve(dir),
    port: 4400,
    webDir: resolve(dir),
  });
});

test('非法参数给出明确错误', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentteam-args-'));
  assert.throws(() => parseArgs(['--port', 'abc']), /--port/);
  assert.throws(() => parseArgs(['--port', '70000']), /--port/);
  assert.throws(() => parseArgs(['--port']), /--port/);
  assert.throws(() => parseArgs(['--root', join(dir, '不存在')]), /--root/);
  assert.throws(() => parseArgs(['--root']), /--root/);
  assert.throws(() => parseArgs(['--nope']), /未知参数/);
});
