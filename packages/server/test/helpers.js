import { createServer, request } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

// 假的 Session：只实现接口层用到的方法，并记录调用。
export function fakeSession(overrides = {}) {
  const calls = { send: [], pause: 0, cancel: 0 };
  let running = false;
  return {
    calls,
    setRunning(value) {
      running = value;
    },
    isRunning: () => running,
    state: async () => ({ stage: 'idle', running, lastSeq: 0 }),
    send: async (text) => {
      calls.send.push(text);
    },
    requestPause: () => {
      calls.pause += 1;
      return true;
    },
    cancel: () => {
      calls.cancel += 1;
      return running;
    },
    ...overrides,
  };
}

// 在随机端口启动一个只用于测试的服务。allowedHosts 在监听之后才知道端口，所以用闭包延迟取值。
export async function start(session, options = {}) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), 'agentteam-server-')));
  let hosts = null;
  const app = createApp({ session, root, allowedHosts: () => hosts, ...options });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    root,
    port,
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

// 不经过 fetch 的原始请求：可以自定义 Host、Origin，也不会对路径做规范化。
export function rawRequest({ port, method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // 不是 JSON
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
