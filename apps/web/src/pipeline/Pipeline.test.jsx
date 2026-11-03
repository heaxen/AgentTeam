import { test, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, StoreProvider } from '../store.jsx';
import Pipeline from './Pipeline.jsx';

test('空闲时五个角色都显示"等待"，阶段显示"等待需求"', () => {
  const store = createStore({ fetchState: async () => ({ ok: true, data: { stage: 'idle', running: false, lastSeq: 0 } }) });
  render(<StoreProvider store={store}><Pipeline /></StoreProvider>);
  expect(screen.getByText('等待需求')).toBeInTheDocument();
  for (const name of ['需求与原型', '架构师', '前端开发', '后端开发', '测试']) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
  expect(screen.getAllByText('等待')).toHaveLength(5);
});

test('运行中与完成、失败、中断各自显示对应文案', async () => {
  const store = createStore({ fetchState: async () => ({ ok: true, data: { stage: 'arch_review', running: true, lastSeq: 3 } }) });
  render(<StoreProvider store={store}><Pipeline /></StoreProvider>);
  await act(() => store.refresh());
  act(() => store.applyEvents([
    { seq: 1, type: 'role.started', role: 'req-analyst', agent: 'claude' },
    { seq: 2, type: 'role.finished', role: 'req-analyst' },
    { seq: 3, type: 'role.started', role: 'architect', agent: 'claude' },
  ]));
  expect(screen.getByText('运行中')).toBeInTheDocument();
  expect(screen.getByText('完成')).toBeInTheDocument();
});

test('点击角色行调用 onSelect', async () => {
  const store = createStore({ fetchState: async () => ({ ok: true, data: { stage: 'idle', running: false, lastSeq: 0 } }) });
  let picked = null;
  render(<StoreProvider store={store}><Pipeline onSelect={(role) => { picked = role; }} /></StoreProvider>);
  await userEvent.click(screen.getByRole('button', { name: /测试/ }));
  expect(picked).toBe('qa');
});
