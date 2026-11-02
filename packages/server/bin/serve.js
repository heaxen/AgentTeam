#!/usr/bin/env node
import { parseArgs } from '../src/args.js';
import { startServer } from '../src/serve.js';

try {
  const { root, port, webDir } = parseArgs(process.argv.slice(2));
  const server = await startServer({ root, port, webDir });
  console.log(`AgentTeam 服务已启动：${server.url}`);
  console.log(`项目目录：${root}`);
  console.log('按 Ctrl+C 停止');
  // 第一次信号：取消运行中的角色，最多等 3 秒收尾，再关闭服务。第二次信号：立即强制退出。
  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('正在停止…');
    server.session.cancel();
    const deadline = Date.now() + 3000;
    while (server.session.isRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (err) {
  console.error(`错误：${err.message}`);
  process.exitCode = 1;
}
