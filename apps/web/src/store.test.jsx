import { test, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createStore, StoreProvider, useStore } from './store.jsx';

function Probe() {
  const view = useStore();
  return (
    <div>
      <span data-testid="stage">{view.state.stage}</span>
      <span data-testid="running">{String(view.state.running)}</span>
      <span data-testid="status">{view.status}</span>
      <span data-testid="output">{JSON.stringify(view.outputs)}</span>
      <span data-testid="messages">{view.messages.map((m) => m.text).join('|')}</span>
    </div>
  );
}

test('applyEvents 累积输出、产物与对话，并触发重新渲染', async () => {
  const store = createStore({ fetchState: vi.fn() });
  render(
    <StoreProvider store={store}>
      <Probe />
    </StoreProvider>,
  );
  act(() => {
    store.applyEvents([
      { seq: 1, type: 'message', from: 'user', text: '做个登录' },
      { seq: 2, type: 'role.output', role: 'architect', chunk: '第一段' },
      { seq: 3, type: 'role.output', role: 'architect', chunk: '第二段' },
      { seq: 4, type: 'message', from: 'team', text: '方案已就绪' },
    ]);
  });
  expect(screen.getByTestId('output').textContent).toBe('{"architect":["第一段","第二段"]}');
  expect(screen.getByTestId('messages').textContent).toBe('做个登录|方案已就绪');
});

test('refresh 读取 /api/state 并写入 state', async () => {
  const fetchState = vi.fn(async () => ({ ok: true, data: { stage: 'arch_review', running: false, lastSeq: 7 } }));
  const store = createStore({ fetchState });
  await store.refresh();
  expect(store.snapshot().state.stage).toBe('arch_review');
  expect(store.snapshot().state.lastSeq).toBe(7);
});

test('refresh 失败时记录 connectError，不覆盖已有 state', async () => {
  const store = createStore({ fetchState: vi.fn(async () => ({ ok: false, error: '无法连接服务' })) });
  await store.refresh();
  expect(store.snapshot().connectError).toBe('无法连接服务');
  expect(store.snapshot().state.stage).toBe('idle');
});

test('connect 用 SSE 推送事件：按 seq 去重、断线改状态、恢复后回到已连接', async () => {
  let handlers;
  const disconnectSpy = vi.fn();
  const createStream = vi.fn((streamHandlers) => {
    handlers = streamHandlers;
    return disconnectSpy;
  });
  const store = createStore({ fetchState: vi.fn(), createStream });
  const disconnect = store.connect();
  expect(createStream).toHaveBeenCalledTimes(1);

  handlers.onOpen();
  expect(store.snapshot().status).toBe('live');

  handlers.onEvent({ seq: 1, type: 'role.output', role: 'qa', chunk: 'a' });
  handlers.onEvent({ seq: 1, type: 'role.output', role: 'qa', chunk: 'a' });
  expect(store.snapshot().outputs.qa).toEqual(['a']);

  handlers.onError();
  expect(store.snapshot().status).toBe('error');
  expect(store.snapshot().connectError).toBe('连接中断，正在重连…');

  handlers.onOpen();
  expect(store.snapshot().status).toBe('live');

  disconnect();
  expect(disconnectSpy).toHaveBeenCalledTimes(1);
});

test('多个推进事件合并成一次刷新，避免历史重放时打出一串请求', async () => {
  vi.useFakeTimers();
  const fetchState = vi.fn(async () => ({ ok: true, data: { stage: 'idle', running: false, lastSeq: 0 } }));
  let handlers;
  const store = createStore({
    fetchState,
    createStream: (streamHandlers) => {
      handlers = streamHandlers;
      return () => {};
    },
  });
  try {
    store.connect();
    handlers.onOpen();
    handlers.onEvent({ seq: 1, type: 'message', from: 'user', text: '一' });
    handlers.onEvent({ seq: 2, type: 'message', from: 'team', text: '二' });
    handlers.onEvent({ seq: 3, type: 'stage.changed', stage: 'arch_review' });
    expect(fetchState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchState).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('首次连接前的状态是"连接中"，且没有事件', () => {
  const store = createStore({ fetchState: vi.fn() });
  expect(store.snapshot().status).toBe('connecting');
  expect(store.snapshot().outputs).toEqual({});
});
