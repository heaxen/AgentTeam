import { runProcess, assertSafeToken, toRunResult } from './process.js';

// Gemini CLI 适配器（headless 模式）。设计见 cli/docs/adapters.md。
// -p 只放一句固定说明，完整提示词经 stdin 传入；官方文档说明两者会拼接。
// --approval-mode auto_edit：自动通过文件编辑；shell 命令仍需批准（见设计文档第五节的已知缺口）。
// 官方文档说明 GEMINI_API_KEY、GOOGLE_API_KEY 会被优先使用，订阅模式需要先删除。
const API_KEY_ENV = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];

export function buildCommand({ model } = {}) {
  const parts = ['gemini', '-p', '"Follow the instructions on stdin"', '-o', 'json', '--approval-mode', 'auto_edit'];
  if (model) parts.push('-m', assertSafeToken(model, 'model'));
  return parts.join(' ');
}

export function buildEnv({ method, apiKey }, base = process.env) {
  const env = { ...base };
  for (const name of API_KEY_ENV) delete env[name];
  if (method === 'api') {
    if (!apiKey) throw new Error('gemini 的 API 认证缺少 key：请运行 agentteam auth gemini --from-env');
    env.GEMINI_API_KEY = apiKey;
  }
  return env;
}

export const geminiAdapter = {
  id: 'gemini',
  canEditFiles: true,

  async run({ prompt, cwd, model, credential = {}, timeoutMs }) {
    const proc = await runProcess({
      command: buildCommand({ model }),
      cwd,
      env: buildEnv(credential),
      input: prompt,
      timeoutMs,
    });

    let parsed;
    try {
      parsed = JSON.parse(proc.stdout);
    } catch {
      return toRunResult(proc, '', 'gemini 输出不是 JSON，无法解析');
    }
    const errorMessage = parsed.error ? `gemini 返回错误：${parsed.error.message ?? '未知错误'}` : undefined;
    return toRunResult(proc, parsed.response ?? '', errorMessage);
  },
};
