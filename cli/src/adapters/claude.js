import { runProcess, assertSafeToken, quotePath, toRunResult } from './process.js';
import { assertAllowedCommand } from '../allowlist.js';

// Claude Code 适配器（无头模式 claude -p）。设计见 cli/docs/adapters.md。
//
// 两种认证方式：
// - subscription：使用 claude auth login 保存的登录。
// - api：使用个人 API key（环境变量 ANTHROPIC_API_KEY）。
//
// 官方认证文档：-p 模式下只要存在 ANTHROPIC_API_KEY 就会使用它，优先于订阅登录。
// 所以订阅模式必须把它从子进程环境中删除，否则会静默改用 API 计费。
const SUBSCRIPTION_ENV_TO_CLEAR = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

// allowedCommands 中的每条命令放行两种写法：完全相同，以及带参数（如 npm test --watch=false）。
// 官方 --allowedTools 的写法为 "Bash(git *)"，这里的模式都由白名单校验后才拼接。
// addDirs：除项目目录外还允许读取的目录（如 CLI 自带的团队公约与角色说明书）。
// 不加的话，无头模式下读取项目之外的文件会被拒绝，角色无法开工。
export function buildCommand({ model, effort, allowedCommands = [], addDirs = [] } = {}) {
  const parts = ['claude', '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'];
  if (model) parts.push('--model', assertSafeToken(model, 'model'));
  if (effort) parts.push('--effort', assertSafeToken(effort, 'effort'));
  if (addDirs.length) parts.push('--add-dir', ...addDirs.map((d) => quotePath(d, '读取目录')));
  if (allowedCommands.length) {
    const patterns = allowedCommands.flatMap((c) => {
      const cmd = assertAllowedCommand(c);
      return [`"Bash(${cmd})"`, `"Bash(${cmd} *)"`];
    });
    parts.push('--allowedTools', ...patterns);
  }
  return parts.join(' ');
}

export function buildEnv({ method, apiKey }, base = process.env) {
  const env = { ...base };
  if (method === 'api') {
    if (!apiKey) throw new Error('claude 的 API 认证缺少 key：请运行 agentteam auth claude --from-env');
    env.ANTHROPIC_API_KEY = apiKey;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return env;
  }
  for (const name of SUBSCRIPTION_ENV_TO_CLEAR) delete env[name];
  return env;
}

export const claudeAdapter = {
  id: 'claude',
  canEditFiles: true,

  async run({ prompt, cwd, model, effort, credential = {}, timeoutMs, allowedCommands = [], addDirs = [] }) {
    const { code, stdout, stderr, timedOut } = await runProcess({
      command: buildCommand({ model, effort, allowedCommands, addDirs }),
      cwd,
      env: buildEnv(credential),
      input: prompt,
      timeoutMs,
    });

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return toRunResult({ code, stderr, timedOut }, '', 'claude 输出不是 JSON，无法解析');
    }
    const errorMessage = parsed.is_error ? `claude 返回错误：${parsed.result}` : undefined;
    return toRunResult({ code, stderr, timedOut }, parsed.result ?? '', errorMessage);
  },
};
