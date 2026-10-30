import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess, assertSafeToken, quotePath, toRunResult } from './process.js';

// OpenAI Codex CLI 适配器（codex exec）。设计见 cli/docs/adapters.md。
// 只支持订阅（ChatGPT 登录）。codex exec 的最终回复写入 -o 指定的文件，从那里读取正文。
// 提示词从 stdin 读取（末尾的 - 表示读 stdin）。
// --skip-git-repo-check：项目不一定是 git 仓库，不能因此拒绝执行。
export function buildCommand({ model, outputFile } = {}) {
  const parts = ['codex', 'exec', '--skip-git-repo-check', '-s', 'workspace-write', '-o', quotePath(outputFile, '输出文件')];
  if (model) parts.push('-m', assertSafeToken(model, 'model'));
  parts.push('-');
  return parts.join(' ');
}

export const codexAdapter = {
  id: 'codex',
  canEditFiles: true,

  async run({ prompt, cwd, model, timeoutMs }) {
    const outputFile = join(tmpdir(), `agentteam-codex-${randomUUID()}.txt`);
    try {
      const proc = await runProcess({
        command: buildCommand({ model, outputFile }),
        cwd,
        env: process.env,
        input: prompt,
        timeoutMs,
      });
      let text = '';
      try {
        text = await readFile(outputFile, 'utf8');
      } catch {
        // 没有输出文件：下面按错误处理
      }
      const errorMessage = proc.code === 0 && !text.trim() ? 'codex 没有写出最终回复' : undefined;
      return toRunResult(proc, text.trim(), errorMessage);
    } finally {
      await rm(outputFile, { force: true });
    }
  },
};
