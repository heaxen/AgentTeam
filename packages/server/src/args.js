import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_PORT } from './serve.js';

function directory(value, flag) {
  if (!value) throw new Error(`${flag} 需要一个目录`);
  const path = resolve(value);
  let ok = false;
  try {
    ok = statSync(path).isDirectory();
  } catch {
    // 不存在
  }
  if (!ok) throw new Error(`${flag} 指向的目录不存在：${path}`);
  return path;
}

export function parseArgs(argv) {
  const options = { root: process.cwd(), port: DEFAULT_PORT, webDir: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--root') options.root = directory(argv[++i], '--root');
    else if (flag === '--web') options.webDir = directory(argv[++i], '--web');
    else if (flag === '--port') {
      const value = argv[++i];
      const port = Number(value);
      if (!value || !Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('--port 必须是 0 到 65535 的整数');
      }
      options.port = port;
    } else throw new Error(`未知参数：${flag}`);
  }
  return options;
}
