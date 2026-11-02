import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createSession } from '@agentteam/core/session';
import { createApp } from './app.js';
import { createStaticHandler } from './static.js';

export const DEFAULT_PORT = 4317;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export async function startServer({
  root,
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  credentialsFile,
  webDir = null,
  session = null,
}) {
  if (!LOOPBACK.has(host)) {
    throw new Error('开放远程访问前需要先实现访问令牌（见 docs/backlog.md B-002），当前只允许监听本机地址');
  }
  const activeSession = session ?? (await createSession({ root }));

  let hosts = null;
  const app = createApp({
    session: activeSession,
    root,
    credentialsFile,
    allowedHosts: () => hosts,
    staticHandler: webDir && existsSync(webDir) ? createStaticHandler(webDir) : null,
  });
  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      reject(err.code === 'EADDRINUSE' ? new Error(`端口 ${port} 已被占用，请用 --port 换一个`) : err);
    });
    server.listen(port, host, resolve);
  });

  const actual = server.address().port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`, `[::1]:${actual}`]);
  const shown = host === '::1' ? '[::1]' : host;

  return {
    url: `http://${shown}:${actual}`,
    port: actual,
    session: activeSession,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
