import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 从仓库根目录的团队文件生成 cli/templates/。
// 根目录是唯一来源，templates/ 由脚本生成、不提交，避免两份副本漂移。
const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const TEMPLATES = join(CLI_ROOT, 'templates');

const FILES = ['AGENTS.md', 'AI开发团队角色与协作流程.md'];

async function copy(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

for (const file of FILES) {
  await copy(join(REPO_ROOT, file), join(TEMPLATES, file));
}

const promptsDir = join(REPO_ROOT, 'prompts');
for (const file of await readdir(promptsDir)) {
  if (file.endsWith('.md')) {
    await copy(join(promptsDir, file), join(TEMPLATES, 'prompts', file));
  }
}


console.log('templates 已从仓库根目录同步');
