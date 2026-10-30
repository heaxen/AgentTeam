import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { chooseUi } from '../src/prompt.js';

function tty() {
  const input = new PassThrough();
  input.isTTY = true;
  return input;
}

test('非终端输入：使用行输入', () => {
  assert.equal(chooseUi(new PassThrough(), {}), 'plain');
});

test('Windows Terminal 与 PowerShell：使用 TUI', () => {
  assert.equal(chooseUi(tty(), {}), 'tui');
  assert.equal(chooseUi(tty(), { WT_SESSION: 'abc' }), 'tui');
});

test('Git Bash（MSYSTEM 存在且不在 Windows Terminal 中）：使用行输入', () => {
  assert.equal(chooseUi(tty(), { MSYSTEM: 'MINGW64' }), 'plain');
  assert.equal(chooseUi(tty(), { MSYSTEM: 'MINGW64', WT_SESSION: 'abc' }), 'tui');
});

test('AGENTTEAM_UI 可以强制指定', () => {
  assert.equal(chooseUi(tty(), { MSYSTEM: 'MINGW64', AGENTTEAM_UI: 'tui' }), 'tui');
  assert.equal(chooseUi(tty(), { AGENTTEAM_UI: 'plain' }), 'plain');
});
