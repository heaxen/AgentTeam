import { runProcess, lineSplitter, assertSafeToken, quotePath, toRunResult } from './process.js';
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
export function buildCommand({ model, effort, allowedCommands = [], addDirs = [], stream = false } = {}) {
  // stream-json 需要同时带 --verbose（以 Step 1 的实测为准，不符就按实测改）。
  const format = stream ? ['stream-json', '--verbose'] : ['json'];
  const parts = ['claude', '-p', '--output-format', ...format, '--permission-mode', 'acceptEdits'];
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

// 流式输出每行一个 JSON。只关心两类：assistant 里的文本块（实时展示），result（最终结果）。
export function parseStreamLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return { texts: [] };
  }
  if (!event || typeof event !== 'object') return { texts: [] };
  if (event.type === 'assistant') {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    return { texts: blocks.filter((b) => b?.type === 'text' && b.text).map((b) => b.text) };
  }
  if (event.type === 'result') {
    return { texts: [], result: { text: event.result ?? '', isError: Boolean(event.is_error) } };
  }
  return { texts: [] };
}

// 流式模式下，结束事件（result）比进程退出码更权威：
// 实测 claude 可能在 result 为成功时仍以非零码退出（stderr 只有模型名告警）。
// 超时时不采信结束事件，仍报超时；没有结束事件时报错。
export function toStreamRunResult({ code, stderr, timedOut }, final) {
  // 超时一律报超时并丢弃结束事件：进程可能在输出完结果后卡住，不能当作正常结束。
  if (timedOut) return toRunResult({ code, stderr, timedOut }, '', undefined);
  if (!final) {
    return toRunResult({ code, stderr, timedOut }, '', 'claude 流式输出中没有结束事件，无法取得结果');
  }
  const errorMessage = final.isError ? `claude 返回错误：${final.text}` : undefined;
  // 以 0 代入退出码来判定成败，再把真实退出码写回结果。
  return { ...toRunResult({ code: 0, stderr, timedOut: false }, final.text, errorMessage), exitCode: code };
}

// 把 stdout 切成行，实时转发文本块，并记下结束事件。
// 先记结束事件再转发文本；onOutput 抛错一律吞掉，不能中断切分，也不能丢掉同一段里的结束事件。
export function createStreamCollector(onOutput) {
  let final = null;
  const lines = lineSplitter((line) => {
    const parsed = parseStreamLine(line);
    if (parsed.result) final = parsed.result;
    for (const text of parsed.texts) {
      try {
        onOutput(`${text}\n`);
      } catch {
        // 忽略
      }
    }
  });
  return {
    push: (text) => lines.push(text),
    end: () => lines.end(),
    final: () => final,
  };
}

export const claudeAdapter = {
  id: 'claude',
  canEditFiles: true,

  async run({ prompt, cwd, model, effort, credential = {}, timeoutMs, allowedCommands = [], addDirs = [], onOutput }) {
    const stream = typeof onOutput === 'function';
    const collector = createStreamCollector(onOutput);

    const { code, stdout, stderr, timedOut } = await runProcess({
      command: buildCommand({ model, effort, allowedCommands, addDirs, stream }),
      cwd,
      env: buildEnv(credential),
      input: prompt,
      timeoutMs,
      onChunk: stream ? (text) => collector.push(text) : undefined,
    });

    if (stream) {
      collector.end();
      return toStreamRunResult({ code, stderr, timedOut }, collector.final());
    }

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
