import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 用户级配置：~/.agentteam/config.json
// 环境变量优先于配置文件，便于 CI 或临时覆盖。
export const CONFIG_DIR = join(homedir(), '.agentteam');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  // 调用模型的方式：'subscription' 走本机 Claude Code（用订阅），'api' 直接调用 Anthropic API（用个人 key）
  mode: 'subscription',
  model: 'claude-sonnet-5-5',
  apiKey: '',
};

export async function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    // 配置文件不存在时使用默认值
  }
  return {
    ...DEFAULTS,
    ...fileConfig,
    ...(process.env.AGENTTEAM_MODE && { mode: process.env.AGENTTEAM_MODE }),
    ...(process.env.AGENTTEAM_MODEL && { model: process.env.AGENTTEAM_MODEL }),
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
  };
}

export async function saveConfig(patch) {
  let current = {};
  try {
    current = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    // 首次保存
  }
  const next = { ...current, ...patch };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
