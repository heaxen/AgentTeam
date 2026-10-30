import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CONFIG_DIR, CONFIG_FILE } from './config.js';
import { join } from 'node:path';

// 凭证单独存放，不与 config.json 混在一起，避免 `config show` 误打印。
// 文件只保存在用户目录，不进入项目仓库。
export const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

export async function loadCredentials(file = CREDENTIALS_FILE) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { agents: {} };
  }
}

// 合并保存某个 agent 的凭证。调用方只能传入该 agent 的字段，不会输出密钥内容。
export async function saveAgentCredential(agentId, patch, file = CREDENTIALS_FILE) {
  const current = await loadCredentials(file);
  const next = {
    agents: { ...current.agents, [agentId]: { ...current.agents?.[agentId], ...patch } },
  };
  await mkdir(join(file, '..'), { recursive: true });
  // mode 仅在 POSIX 系统生效；Windows 下依赖用户目录本身的访问控制。
  await writeFile(file, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}

// 判断某个 agent 是否可直接使用：环境变量里已有 key，或本机保存过 key / 登录记录。
export function isAuthenticated(agent, credential = {}, env = process.env) {
  if (agent.apiKeyEnv?.some((name) => env[name])) return true;
  if (agent.tokenEnv?.some((name) => env[name])) return true;
  return Boolean(credential.apiKey || credential.loggedInAt);
}
