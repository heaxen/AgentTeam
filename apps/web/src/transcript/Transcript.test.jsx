import { test, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createStore, StoreProvider } from '../store.jsx';
import Transcript from './Transcript.jsx';

test('空态给出下一步动作', () => {
  const store = createStore({ fetchState: async () => ({ ok: false, error: '' }) });
  render(<StoreProvider store={store}><Transcript /></StoreProvider>);
  expect(screen.getByText('还没有对话，在下面输入需求开始。')).toBeInTheDocument();
});

test('按顺序显示用户与团队的对话', () => {
  const store = createStore({ fetchState: async () => ({ ok: false, error: '' }) });
  render(<StoreProvider store={store}><Transcript /></StoreProvider>);
  act(() => store.applyEvents([
    { seq: 1, type: 'message', from: 'user', text: '做一个登录页面' },
    { seq: 2, type: 'message', from: 'team', text: '方案已就绪：A. Node + React' },
  ]));
  expect(screen.getByText('做一个登录页面')).toBeInTheDocument();
  expect(screen.getByText(/方案已就绪/)).toBeInTheDocument();
  expect(screen.getByText('你')).toBeInTheDocument();
  expect(screen.getByText('团队')).toBeInTheDocument();
});
