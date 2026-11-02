import { AGENTS, getAgent } from '@agentteam/core/agents';
import { isAuthenticated, loadCredentials, saveAgentCredential } from '@agentteam/core/credentials';
import { HttpError } from './http-util.js';

// 给界面用的 agent 列表。只含"能选什么"和"是否已认证"，不含任何凭证内容。
export async function listAgents(credentialsFile) {
  const credentials = await loadCredentials(credentialsFile);
  return AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
    models: agent.models ?? [],
    efforts: agent.efforts ?? [],
    authenticated: isAuthenticated(agent, credentials.agents[agent.id]),
  }));
}

// 保存认证。错误信息一律用固定文案，不回显请求内容（apiKey 不能进入响应或日志）。
export async function saveAuth(agentId, body, credentialsFile) {
  let agent;
  try {
    agent = getAgent(agentId);
  } catch {
    throw new HttpError(404, `未知 agent：${agentId}`);
  }
  const now = new Date().toISOString();

  if (body.method === 'api') {
    const usesKey = agent.kind === 'api' || (agent.apiKeyEnv?.length ?? 0) > 0;
    if (!usesKey) throw new HttpError(400, `${agent.name} 不使用 API key`);
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!key || key.length > 512 || /\s/.test(key)) throw new HttpError(400, 'apiKey 不合法');
    await saveAgentCredential(agent.id, { method: 'api', apiKey: key, savedAt: now }, credentialsFile);
  } else if (body.method === 'confirm') {
    // 订阅登录需要终端交互，无法经 HTTP 完成；这里只记录"用户已经在终端登录过"。
    if (agent.kind === 'api') throw new HttpError(400, `${agent.name} 只能使用 API key`);
    await saveAgentCredential(agent.id, { method: 'subscription', loggedInAt: now }, credentialsFile);
  } else {
    throw new HttpError(400, "method 必须是 'api' 或 'confirm'");
  }
  return { agent: agent.id, authenticated: true };
}
