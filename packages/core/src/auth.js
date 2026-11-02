import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { getAgent } from './agents.js';
import { saveAgentCredential, loadCredentials, isAuthenticated, CREDENTIALS_FILE } from './credentials.js';

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

export async function askLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// 读取密钥：输入时不回显。利用 readline 的输出钩子，在提问之后屏蔽字符回显。
export function askSecret(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question).then(
      (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer.trim());
      },
      reject,
    );
    muted = true;
  });
}

// agentteam auth <agent> 的完整流程，命令行和对话（/auth）共用。
// 返回退出码。密钥只写入凭证文件，不输出、不记录。
export async function runAuth({
  id,
  flags = new Set(),
  emit = () => {},
  log = console.log,
  file = CREDENTIALS_FILE,
  ask = askLine,
  askKey = askSecret,
  runLogin = runLoginCommand,
}) {
  let agent;
  try {
    agent = getAgent(id);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  if (flags.has('--from-env')) {
    const found = keyFromEnv(agent);
    if (!found) {
      console.error(`环境变量中没有找到 ${agent.apiKeyEnv?.join(' / ') || '（该 agent 不使用 API key）'}`);
      return 1;
    }
    await saveAgentCredential(agent.id, { method: 'api', apiKey: found.value, savedAt: new Date().toISOString() }, file);
    emit('auth.saved', { agent: agent.id, from: found.name });
    log(`已从 ${found.name} 读取并保存 ${agent.name} 的 key（不会显示内容）`);
    return 0;
  }

  if (flags.has('--confirm')) {
    await saveAgentCredential(agent.id, { method: 'subscription', loggedInAt: new Date().toISOString() }, file);
    emit('auth.confirmed', { agent: agent.id });
    log(`已记录 ${agent.name} 为已认证`);
    return 0;
  }

  const hasLogin = Boolean(agent.loginCommand);
  const hasKey = Boolean(agent.apiKeyEnv?.length);

  // 选择方式：只有 API 的 agent 直接要 key；既能订阅又能 key 的，让用户选。
  let method = 'subscription';
  if (agent.kind === 'api') {
    method = 'api';
  } else if (hasKey) {
    const choice = await ask(`${agent.name}：1 订阅登录  2 粘贴 API key（输入不显示）  [1]：`);
    method = choice === '2' ? 'api' : 'subscription';
  }

  if (method === 'api') {
    const key = await askKey(`请粘贴 ${agent.name} 的 API key（输入不显示，直接回车取消）：`);
    if (!key) {
      console.error('未输入 key，未保存。');
      return 1;
    }
    await saveAgentCredential(agent.id, { method: 'api', apiKey: key, savedAt: new Date().toISOString() }, file);
    emit('auth.saved', { agent: agent.id, method: 'api' });
    log(`${agent.name} 的 API key 已保存（不会显示内容）。之后调用不再要求认证。`);
    return 0;
  }

  if (hasLogin) {
    log(`正在启动 ${agent.name} 的登录：${agent.loginCommand}`);
    const code = await runLogin(agent);
    if (code !== 0) {
      console.error(`登录未完成（退出码 ${code}），未记录认证状态。`);
      return 1;
    }
    await saveAgentCredential(agent.id, { method: 'subscription', loggedInAt: new Date().toISOString() }, file);
    emit('auth.saved', { agent: agent.id, method: 'subscription' });
    log(`${agent.name} 已登录，之后调用不再要求认证。`);
    return 0;
  }

  log(`${agent.name} 没有可直接启动的登录命令，请手动完成登录：`);
  log(`  ${agent.login}`);
  log(`完成后执行：agentteam auth ${agent.id} --confirm`);
  return 0;
}

// 指定 agent 之后调用：未认证时直接进入登录或输入 key 的流程；已认证则什么也不做。
// 返回 true 表示已可用（本来就可用，或刚刚完成认证）。
export async function authIfNeeded(agentId, options = {}) {
  const { file = CREDENTIALS_FILE } = options;
  const agent = getAgent(agentId);
  const credentials = await loadCredentials(file);
  if (isAuthenticated(agent, credentials.agents[agentId])) return true;
  const code = await runAuth({ id: agentId, file, ...options });
  return code === 0;
}
