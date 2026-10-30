import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { createPrompt } from '../src/prompt.js';

process.env.AGENTTEAM_UI = 'tui';

// 模拟终端：可以写入按键字节（如 \x1b[B 为下箭头，\r 为回车）。
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
  output.text = () => chunks.join('');
  return output;
}

const LABELS = ['a', 'b', 'c'];

test('上下键移动、回车确认', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const before = input.isRaw; // readline 创建时已设为 raw
  const pending = prompt.select({ title: '选择', labels: LABELS });
  input.write('\x1b[B'); // 下
  input.write('\r');
  assert.equal(await pending, 1);
  assert.equal(input.isRaw, before, '选择结束后恢复原来的 raw 模式');
  prompt.close();
});

test('上箭头从第一项回绕到最后一项', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.select({ title: '选择', labels: LABELS });
  input.write('\x1b[A'); // 上
  input.write('\r');
  assert.equal(await pending, 2);
  prompt.close();
});

test('直接输入编号并回车，与上下键的结果一致', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.select({ title: '选择', labels: LABELS });
  input.write('3');
  input.write('\r');
  assert.equal(await pending, 2);
  prompt.close();
});

test('编号超出范围时忽略，不会选中', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.select({ title: '选择', labels: LABELS });
  input.write('9');
  input.write('\r');
  assert.equal(await pending, 0);
  prompt.close();
});

test('Ctrl+C 取消，返回 null', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.select({ title: '选择', labels: LABELS });
  input.write('\x03');
  assert.equal(await pending, null);
  prompt.close();
});

test('选择结束后，普通的 line 输入仍然正常工作', async () => {
  const input = fakeTty();
  const prompt = createPrompt({ input, output: sink() });
  const pending = prompt.select({ title: '选择', labels: LABELS });
  input.write('\r');
  await pending;
  const line = prompt.line('> ');
  input.write('hi\r');
  assert.equal(await line, 'hi');
  prompt.close();
});

test('非终端输入不提供 select，调用方回退到编号输入', () => {
  const input = new PassThrough();
  const prompt = createPrompt({ input, output: sink() });
  assert.equal(prompt.select, undefined);
  prompt.close();
});
