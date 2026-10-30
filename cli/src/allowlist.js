import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// 允许 agent 执行的验证命令（如 npm test），由用户或 PM 维护：team/allowed-commands.json
// 文件不存在时视为没有任何允许的命令。只放整条命令，执行时必须整条匹配，不接受额外参数或拼接。
export const ALLOWLIST_FILE = join('team', 'allowed-commands.json');

// 只允许字母、数字、空格和 . _ / : -。不允许引号、分号、管道等 shell 元字符，避免命令注入。
const SAFE_COMMAND = /^[A-Za-z0-9 ._/:-]+$/;

export function assertAllowedCommand(command) {
  if (typeof command !== 'string' || !SAFE_COMMAND.test(command) || command !== command.trim()) {
    throw new Error(`${ALLOWLIST_FILE} 中的命令不合法（只允许字母、数字、空格和 . _ / : -）：${command}`);
  }
  return command;
}

export async function loadAllowedCommands(root) {
  let data;
  try {
    data = JSON.parse(await readFile(join(root, ALLOWLIST_FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`${ALLOWLIST_FILE} 不是合法的 JSON：${err.message}`);
  }
  return (data.commands ?? []).map(assertAllowedCommand);
}
