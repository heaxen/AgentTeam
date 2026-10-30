import { spawn } from 'node:child_process';

// 启动 agent 自己的登录命令。命令来自注册表（已核对），不接受用户输入，避免命令注入。
// 返回退出码；0 表示登录命令正常结束。
export function runLoginCommand(agent) {
  return new Promise((resolve, reject) => {
    const child = spawn(agent.loginCommand, { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// 从环境变量读取 key 并保存。key 不经过命令行参数，避免留在 shell 历史里。
export function keyFromEnv(agent, env = process.env) {
  const name = agent.apiKeyEnv?.find((n) => env[n]);
  if (!name) return null;
  return { name, value: env[name] };
}
