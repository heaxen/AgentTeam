import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { createPrompt } from '../src/prompt.js';
import { displayWidth } from '../src/tui.js';

// 这些测试针对 TUI 本身，不论运行环境（如 Git Bash）如何，都强制使用 TUI。
process.env.AGENTTEAM_UI = 'tui';

function fakeTty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  return input;
}

function sink() {
  const chunks = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  output.columns = 60;
  output.text = () => chunks.join('');
  return output;
}

// 等待终端事件被处理（按键通过流异步送达）。
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('显示宽度：中文占两列，英文占一列', () => {
  assert.equal(displayWidth('AgentTeam'), 9);
  assert.equal(displayWidth('对话'), 4);
  assert.equal(displayWidth('a对b'), 4);
});

test('输入框：退格、插入与回车提交', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.line('你> ');
  input.write('ab');
  input.write('\x7f'); // 退格
  input.write('c');
  input.write('\r');
  assert.equal(await pending, 'ac');
  prompt.close();
});

test('输入中文：正常提交', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.line('你> ');
  input.write('做一个待办页面\r');
  assert.equal(await pending, '做一个待办页面');
  prompt.close();
});

test('secret：输入内容不出现在任何输出里', async () => {
  const input = fakeTty();
  const output = sink();
  const prompt = createPrompt({ input, output });
  const pending = prompt.secret('API key：');
  input.write('sk-SECRET-999');
  await tick();
  input.write('\r');
  assert.equal(await pending, 'sk-SECRET-999');
  assert.equal(output.text().includes('SECRET'), false, '密钥不得出现在屏幕输出中');
  prompt.close();
});

test('可取消的输入：Ctrl+C 有字时先清空，输入为空时返回"取消"', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const first = prompt.line('', { cancelable: true });
  input.write('写错了');
  await tick();
  input.write('\x03');
  await tick();
  input.write('新内容\r');
  assert.equal(await first, '新内容');

  const second = prompt.line('', { cancelable: true });
  input.write('\x03');
  assert.equal(await second, '取消');
  prompt.close();
});

test('Ctrl+C 取消输入，返回 null', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.line('你> ');
  input.write('\x03');
  assert.equal(await pending, null);
  prompt.close();
});

test('print 输出到记录区域，console.log 也会被导向同一区域，结束后恢复', async () => {
  const input = fakeTty();
  const output = sink();
  const originalLog = console.log;
  const prompt = createPrompt({ input, output });
  prompt.print('第一条记录');
  console.log('第二条记录');
  assert.match(output.text(), /第一条记录/);
  assert.match(output.text(), /第二条记录/);
  prompt.close();
  assert.equal(console.log, originalLog, '关闭后 console.log 恢复原样');
  assert.equal(input.isRaw, false);
});

test('团队执行时，输入框仍可编辑，但回车不会提交', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  prompt.setBusy('团队执行中');
  input.write('提前写的内容');
  input.write('\r');
  await tick();
  // 之后开始的读取仍能拿到提前写下的内容
  const pending = prompt.line('你> ');
  input.write('\r');
  assert.equal(await pending, '提前写的内容');
  prompt.setBusy(null);
  prompt.close();
});

test('底部区域每一段可见文字都不占满最后一列，长中文输入也不会错位', async () => {
  const input = fakeTty();
  const output = sink();
  output.columns = 40;
  const prompt = createPrompt({ input, output });
  try {
    prompt.setStatus({ left: 'C:/很长很长的项目目录/名字/AgentTeam', right: 'claude ×6  codex ×2' });
    prompt.setBusy('团队执行中');
    const pending = prompt.line('你> ');
    input.write('帮我写一个很长很长很长很长很长很长很长很长很长很长的需求描述');
    await tick();
    // 每段连续的可见文字（在转义序列或换行处断开）都必须少于终端宽度
    const runs = output.text().split(/\x1b\[[0-9;]*[A-Za-z]|\r|\n/).filter(Boolean);
    for (const run of runs) {
      assert.ok(displayWidth(run) < 40, `整行写满：${run}`);
    }
    input.write('\r');
    await pending;
  } finally {
    prompt.setBusy(null);
    prompt.close();
  }
});
