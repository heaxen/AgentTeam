import { ROLES, resolveAssignments } from './assign.js';
import { getAgent } from './agents.js';
import { loadCredentials, isAuthenticated } from './credentials.js';
import { hasAdapter } from './adapters/index.js';
import { ROLE_NAMES } from './workflow.js';

// 每个角色的 agent、模型、认证与可执行状态。命令行与对话共用，保证显示一致。
export async function roleRows(root) {
  const resolved = await resolveAssignments(root);
  const credentials = await loadCredentials();
  return ROLES.map((role) => {
    const { agent: agentId, model, effort } = resolved[role];
    const agent = getAgent(agentId);
    return {
      role,
      name: ROLE_NAMES[role],
      agent: agentId,
      model,
      effort,
      authenticated: isAuthenticated(agent, credentials.agents[agentId]),
      runnable: hasAdapter(agentId),
    };
  });
}

export function formatRoles(rows) {
  return rows.map((r) => {
    const model = r.model ?? '（agent 默认）';
    const effort = r.effort ?? '（agent 默认）';
    const auth = r.authenticated ? '已认证' : '未认证';
    const run = r.runnable ? '' : '；未接入执行适配器';
    return `${r.name}（${r.role}）  ${r.agent}  模型：${model}  思考：${effort}  ${auth}${run}`;
  });
}
