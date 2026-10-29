import { spawn } from 'node:child_process';

// 订阅模式：调用本机已登录的 Claude Code（claude -p），消耗的是订阅额度。
// 提示词通过 stdin 传入，避免命令行长度限制。
// Windows 上 claude 是 .cmd 包装，需要 shell；因此命令只拼固定字符串，model 名先做白名单校验。
const SHELL = true;

function buildCommand(model) {
  if (model && !/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error(`model 名称含非法字符：${model}`);
  }
  return ['claude', '-p', '--output-format', 'json', ...(model ? ['--model', model] : [])].join(' ');
}

export const subscriptionProvider = {
  name: 'subscription',

  async available() {
    return new Promise((resolve) => {
      const child = spawn('claude --version', { shell: SHELL, stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  },

  async run({ prompt, cwd, model }) {
    const command = buildCommand(model);

    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(command, { cwd, shell: SHELL, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`claude 退出码 ${code}：${err.trim()}`));
      });
      child.stdin.end(prompt);
    });

    const parsed = JSON.parse(stdout);
    if (parsed.is_error) throw new Error(`claude 返回错误：${parsed.result}`);
    return { text: parsed.result, raw: parsed };
  },
};
