import { test, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createStore, StoreProvider } from '../store.jsx';
import RolePanel from './RolePanel.jsx';

test('没有事件时显示两个空态', () => {
  const store = createStore({ fetchState: async () => ({ ok: false, error: '' }) });
  render(<StoreProvider store={store}><RolePanel role="architect" /></StoreProvider>);
  expect(screen.getByRole('heading', { name: '架构师' })).toBeInTheDocument();
  expect(screen.getByText('尚无产物')).toBeInTheDocument();
  expect(screen.getByText('等待输出…')).toBeInTheDocument();
});

test('只显示所选角色的输出与产物，多段输出按顺序拼接', () => {
  const store = createStore({ fetchState: async () => ({ ok: false, error: '' }) });
  render(<StoreProvider store={store}><RolePanel role="architect" /></StoreProvider>);
  act(() => store.applyEvents([
    { seq: 1, type: 'role.output', role: 'req-analyst', chunk: '需求的输出' },
    { seq: 2, type: 'role.output', role: 'architect', chunk: '第一段' },
    { seq: 3, type: 'role.output', role: 'architect', chunk: '第二段' },
    { seq: 4, type: 'role.files', role: 'architect', files: ['docs/architecture/ARCH-001-summary.md'] },
  ]));
  expect(screen.queryByText('需求的输出')).toBeNull();
  expect(screen.getByText('第一段')).toBeInTheDocument();
  expect(screen.getByText('第二段')).toBeInTheDocument();
  expect(screen.getByText('docs/architecture/ARCH-001-summary.md')).toBeInTheDocument();
});

test('状态文案跟随角色状态', async () => {
  const store = createStore({ fetchState: async () => ({ ok: true, data: { stage: 'arch_review', running: true, lastSeq: 0 } }) });
  render(<StoreProvider store={store}><RolePanel role="architect" /></StoreProvider>);
  await act(() => store.refresh());
  act(() => store.applyEvents([{ seq: 1, type: 'role.started', role: 'architect', agent: 'claude' }]));
  expect(screen.getByText('运行中')).toBeInTheDocument();
});
