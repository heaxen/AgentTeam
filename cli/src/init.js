import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

// 协作目录（与应用代码无关，见 AGENTS.md 第 2.1 节）
const DIRS = [
  'team/tasks',
  'team/roles',
  'stacks',
  'docs/requirements',
  'docs/prototype',
  'docs/design',
  'docs/api',
  'docs/frontend',
  'docs/backend',
  'docs/bugs',
  'docs/acceptance',
  'docs/decisions',
  'docs/changelog',
  'docs/architecture',
  'tests/cases',
  'tests/reports',
  'tests/smoke',
];

// 模板文件 → 项目内路径
const FILES = [
  ['AGENTS.md', 'AGENTS.md'],
  ['AI开发团队角色与协作流程.md', 'AI开发团队角色与协作流程.md'],
  ['stacks/_template.md', 'stacks/_template.md'],
  ...['pm', 'req-analyst', 'prototype', 'architect', 'ui-dev', 'frontend-dev', 'backend-dev', 'qa'].map(
    (role) => [`prompts/${role}.md`, `team/roles/${role}.md`],
  ),
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 幂等初始化：已存在的文件一律不覆盖，只报告跳过了哪些。
// 这样对已有项目是安全的，用户自己改过的公约不会被冲掉。
export async function initProject(root, emit) {
  const created = [];
  const skipped = [];

  for (const dir of DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }

  for (const [from, to] of FILES) {
    const target = join(root, to);
    if (await exists(target)) {
      skipped.push(to);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(TEMPLATES, from), target);
    created.push(to);
  }

  emit('init.done', { root, created, skipped });
  return { created, skipped };
}
