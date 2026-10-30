import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { AGENTS, getAgent } from './agents.js';

// 团队角色，与公约第 2.1 节的角色一致。
export const ROLES = ['pm', 'req-analyst', 'prototype', 'architect', 'ui-dev', 'frontend-dev', 'backend-dev', 'qa'];

// 没有指定时，角色默认由 claude 执行。
export const DEFAULT_AGENT = 'claude';

// 角色分配属于项目的团队配置，放在 team/ 下，可以随项目提交。不含任何凭证。
export function assignmentsFile(root) {
  return join(root, 'team', 'assignments.json');
}

export async function loadAssignments(root) {
  try {
    return JSON.parse(await readFile(assignmentsFile(root), 'utf8'));
  } catch {
    return { version: 1, assignments: {} };
  }
}

export async function assignRole(root, role, agentId) {
  if (!ROLES.includes(role)) throw new Error(`未知角色：${role}（可选：${ROLES.join('、')}）`);
  getAgent(agentId);
  const current = await loadAssignments(root);
  const next = { version: 1, assignments: { ...current.assignments, [role]: agentId } };
  await mkdir(dirname(assignmentsFile(root)), { recursive: true });
  await writeFile(assignmentsFile(root), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export async function assignAll(root, agentId) {
  getAgent(agentId);
  let result = await loadAssignments(root);
  for (const role of ROLES) {
    result = await assignRole(root, role, agentId);
  }
  return result;
}

// 返回每个角色实际使用的 agent：有分配用分配的，没有用默认值。
export async function resolveAssignments(root) {
  const { assignments } = await loadAssignments(root);
  return Object.fromEntries(ROLES.map((role) => [role, assignments[role] ?? DEFAULT_AGENT]));
}

export const AGENT_IDS = AGENTS.map((a) => a.id);
