import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { AGENTS, getAgent, supportsEffort } from './agents.js';

// 团队角色，与公约第 2.1 节的角色一致。
export const ROLES = ['pm', 'req-analyst', 'prototype', 'architect', 'ui-dev', 'frontend-dev', 'backend-dev', 'qa'];

// 没有指定时，角色默认由 claude 执行，模型与思考强度用 agent 自己的默认值。
export const DEFAULT_AGENT = 'claude';

// 模型名会作为命令行参数传给 agent，只允许安全字符，防止注入。
const SAFE_MODEL = /^[A-Za-z0-9._:/-]+$/;

// 角色分配属于项目的团队配置，放在 team/ 下，可以随项目提交。不含任何凭证。
// 格式（version 3）：{ "assignments": { "backend-dev": { "agent": "codex", "model": "gpt-5", "effort": "high" } } }
// 旧格式（字符串，或没有 effort 的对象）读取时自动补全。
export function assignmentsFile(root) {
  return join(root, 'team', 'assignments.json');
}

function normalize(value) {
  if (!value) return null;
  if (typeof value === 'string') return { agent: value, model: null, effort: null };
  return { agent: value.agent, model: value.model ?? null, effort: value.effort ?? null };
}

export async function loadAssignments(root) {
  try {
    const raw = JSON.parse(await readFile(assignmentsFile(root), 'utf8'));
    const assignments = Object.fromEntries(
      Object.entries(raw.assignments ?? {}).map(([role, value]) => [role, normalize(value)]),
    );
    return { version: 3, assignments };
  } catch {
    return { version: 3, assignments: {} };
  }
}

async function save(root, assignments) {
  const next = { version: 3, assignments };
  await mkdir(dirname(assignmentsFile(root)), { recursive: true });
  await writeFile(assignmentsFile(root), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function checkRole(role) {
  if (!ROLES.includes(role)) throw new Error(`未知角色：${role}（可选：${ROLES.join('、')}）`);
}

export function checkModel(model) {
  if (model == null || model === '') return null;
  if (!SAFE_MODEL.test(model)) throw new Error(`模型名只能包含字母、数字与 . _ : / -：${model}`);
  return model;
}

// 思考强度必须是该 agent 支持的取值；agent 不支持按次设置时拒绝。
export function checkEffort(agentId, effort) {
  if (effort == null || effort === '') return null;
  const agent = getAgent(agentId);
  if (!supportsEffort(agent)) throw new Error(`${agent.name} 不支持按次设置思考强度`);
  if (!agent.efforts.includes(effort)) {
    throw new Error(`${agent.name} 的思考强度可选：${agent.efforts.join('、')}（收到：${effort}）`);
  }
  return effort;
}

// 指定角色的 agent、模型与思考强度。换 agent 时模型与强度都清空，因为旧值通常不适用于新 agent。
export async function assignRole(root, role, agentId, model = null, effort = null) {
  checkRole(role);
  getAgent(agentId);
  const current = await loadAssignments(root);
  const entry = { agent: agentId, model: checkModel(model), effort: checkEffort(agentId, effort) };
  return save(root, { ...current.assignments, [role]: entry });
}

// 只改模型，agent 不变，思考强度保留（若新模型下强度仍有效，由调用方决定）。
export async function setRoleModel(root, role, model) {
  checkRole(role);
  const current = await loadAssignments(root);
  const existing = current.assignments[role] ?? { agent: DEFAULT_AGENT, model: null, effort: null };
  return save(root, { ...current.assignments, [role]: { ...existing, model: checkModel(model) } });
}

// 只改思考强度，agent 与模型不变。
export async function setRoleEffort(root, role, effort) {
  checkRole(role);
  const current = await loadAssignments(root);
  const existing = current.assignments[role] ?? { agent: DEFAULT_AGENT, model: null, effort: null };
  return save(root, { ...current.assignments, [role]: { ...existing, effort: checkEffort(existing.agent, effort) } });
}

export async function assignAll(root, agentId, model = null, effort = null) {
  getAgent(agentId);
  let result;
  for (const role of ROLES) {
    result = await assignRole(root, role, agentId, model, effort);
  }
  return result;
}

// 返回每个角色实际使用的 agent、模型与思考强度：有分配用分配的，没有用默认值（null 表示 agent 默认）。
export async function resolveAssignments(root) {
  const { assignments } = await loadAssignments(root);
  return Object.fromEntries(
    ROLES.map((role) => [role, assignments[role] ?? { agent: DEFAULT_AGENT, model: null, effort: null }]),
  );
}

export const AGENT_IDS = AGENTS.map((a) => a.id);
