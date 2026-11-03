import { test, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, StoreProvider } from '../store.jsx';
import Composer from './Composer.jsx';

// 每个测试注入自己的假 fetch：记录请求，返回成功。
// state 通过 store.refresh() 注入，Composer 不负责取状态。
async function setup(state) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true }) };
  }));
  const store = createStore({ fetchState: async () => ({ ok: true, data: { ...state, lastSeq: 0 } }) });
  render(<StoreProvider store={store}><Composer /></StoreProvider>);
  await act(() => store.refresh());
  return { calls, store };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

test('空闲态：输入内容点发送，发出 POST /api/message', async () => {
  const { calls } = await setup({ stage: 'idle', running: false });
  await userEvent.type(screen.getByRole('textbox', { name: '需求或意见输入' }), '做一个登录页面');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(calls).toEqual([{ url: '/api/message', method: 'POST', body: { text: '做一个登录页面' } }]);
});

test('输入为空时发送按钮禁用', async () => {
  await setup({ stage: 'idle', running: false });
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
});

test('方案阶段：发送按钮可用，可发送字母选择', async () => {
  const { calls } = await setup({ stage: 'arch_review', running: false });
  await userEvent.type(screen.getByRole('textbox', { name: '需求或意见输入' }), 'A');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(calls[0].body).toEqual({ text: 'A' });
});

test('失败态：显示重试，点击发送"重试"', async () => {
  const { calls } = await setup({ stage: 'failed', running: false });
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(calls[0].body).toEqual({ text: '重试' });
});

test('暂停态：显示继续，点击发送"继续"', async () => {
  const { calls } = await setup({ stage: 'paused', running: false });
  await userEvent.click(screen.getByRole('button', { name: '继续' }));
  expect(calls[0].body).toEqual({ text: '继续' });
});

test('运行中：显示暂停与取消，隐藏发送；取消发出 POST /api/cancel', async () => {
  const { calls } = await setup({ stage: 'arch_review', running: true });
  expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '暂停' }));
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(calls).toEqual([
    { url: '/api/pause', method: 'POST', body: null },
    { url: '/api/cancel', method: 'POST', body: null },
  ]);
});
