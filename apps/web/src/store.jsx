import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { fetchState as apiFetchState } from './api.js';
import { EMPTY_VIEW, reduceEvents } from './text.js';

// 流程推进的事件到达后补拉一次 /api/state：stage 与 running 以磁盘状态为准。
// role.started / role.output / role.files 不影响 stage 与 running，不需要重拉。
const RESYNC_TYPES = new Set(['stage.changed', 'role.finished', 'role.failed', 'message']);
// 两个原因让刷新必须延迟且合并：
// 1) stage.changed 是这一轮的收尾事件，但服务端发出它之后才把 running 置回 false
//    （session.send 的 finally）。立刻刷新会读到 running: true，而之后再没有事件来纠正，
//    发送按钮会永久消失。
// 2) 首次连接会重放全部历史，每条 message 都触发一次刷新就是几十个并发请求。
const SETTLE_MS = 200;

export function openEventSource({ onOpen, onError, onEvent }) {
  // 不带 after 参数：服务端会优先用 after 查询参数，那样浏览器自动重连时永远从同一个
  // 旧序号重放，会重复推事件。不传时服务端按 Last-Event-ID 续传，首次连接从 0 全量重放。
  const source = new EventSource('/api/events');
  source.onopen = () => onOpen();
  source.onerror = () => onError();
  source.onmessage = (message) => {
    let event = null;
    try {
      event = JSON.parse(message.data);
    } catch {
      return; // 损坏的一行：跳过，不打断整条流
    }
    onEvent(event);
  };
  return () => source.close();
}

export function createStore({ fetchState = apiFetchState, createStream = openEventSource } = {}) {
  let snapshot = {
    status: 'connecting',
    connectError: null,
    state: { stage: 'idle', running: false, lastSeq: 0 },
    ...EMPTY_VIEW,
  };
  const listeners = new Set();
  let disconnect = null;
  let lastSeen = 0;
  let resyncTimer = null;

  const set = (patch) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const store = {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      const result = await fetchState();
      if (result.ok) set({ state: result.data, connectError: null });
      else set({ connectError: result.error });
      return result;
    },
    applyEvents(events) {
      set(events.reduce((view, event) => ({ ...view, ...reduceEvents(view, event) }), snapshot));
    },
    connect() {
      if (disconnect) return disconnect;
      // 合并刷新：200ms 内的多个触发只拉一次。
      const scheduleResync = () => {
        if (resyncTimer) return;
        resyncTimer = setTimeout(() => {
          resyncTimer = null;
          store.refresh();
        }, SETTLE_MS);
      };
      const close = createStream({
        onOpen: () => set({ status: 'live', connectError: null }),
        onError: () => set({ status: 'error', connectError: '连接中断，正在重连…' }),
        onEvent: (event) => {
          // 首次连接会全量重放，重连时服务端可能重发边界事件：按 seq 去重。
          if (!Number.isInteger(event?.seq) || event.seq <= lastSeen) return;
          lastSeen = event.seq;
          store.applyEvents([event]);
          if (RESYNC_TYPES.has(event.type)) scheduleResync();
        },
      });
      disconnect = () => {
        close();
        if (resyncTimer) {
          clearTimeout(resyncTimer);
          resyncTimer = null;
        }
        disconnect = null;
      };
      return disconnect;
    },
  };
  return store;
}

const StoreContext = createContext(null);

export function StoreProvider({ store, children }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore 必须在 StoreProvider 内使用');
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

export function useEventStream(store) {
  useEffect(() => {
    store.refresh();
    return store.connect();
  }, [store]);
  const { status, connectError } = useStore();
  return { status, connectError };
}
