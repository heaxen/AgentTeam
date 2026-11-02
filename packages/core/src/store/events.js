import { appendFile, mkdir, readFile, truncate } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeEvent } from '@agentteam/protocol';

// 事件落盘位置：用户项目目录下，一行一个 JSON。刷新页面或换设备连接时，用它重放出当前视图。
export const EVENTS_FILE = join('team', 'events.jsonl');

async function readAll(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  // 最后一行没有换行结尾说明上次写到一半就崩溃了：截掉残片，否则下一次追加会和它粘成一行。
  // 用 truncate 而不是整文件重写：修复过程中再崩溃也不会丢掉整份日志。
  if (text && !text.endsWith('\n')) {
    text = text.slice(0, text.lastIndexOf('\n') + 1);
    await truncate(file, Buffer.byteLength(text, 'utf8'));
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      // 能解析但不是事件的行（null、数字、没有整数 seq 的对象）同样跳过。
      if (event && typeof event === 'object' && Number.isInteger(event.seq)) events.push(event);
    } catch {
      // 损坏的行：跳过，不让它挡住启动。
    }
  }
  return events;
}

export async function createEventLog(root) {
  const file = join(root, EVENTS_FILE);
  await mkdir(dirname(file), { recursive: true });
  const events = await readAll(file);
  let seq = events.reduce((max, e) => Math.max(max, e.seq), 0);
  const listeners = new Set();
  // 写盘串行排队，保证文件里的顺序与 seq 一致；出错记下来，由 flush 抛出。
  let writing = Promise.resolve();
  let writeError = null;

  return {
    emit(type, data = {}) {
      // 先校验再占用序号：非法事件不会留下空洞。
      const event = makeEvent(type, data, { seq: seq + 1 });
      seq = event.seq;
      events.push(event);
      writing = writing
        .then(() => appendFile(file, `${JSON.stringify(event)}\n`, 'utf8'))
        .catch((err) => {
          writeError = err;
        });
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // 订阅者出错不能影响写入，也不能挡住其他订阅者。
        }
      }
      return event;
    },
    after(since) {
      return events.filter((e) => e.seq > since);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async flush() {
      await writing;
      if (writeError) {
        const err = writeError;
        writeError = null;
        throw err;
      }
    },
    get lastSeq() {
      return seq;
    },
  };
}
