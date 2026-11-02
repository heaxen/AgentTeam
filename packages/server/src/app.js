import { ROLES, assignRole, checkEffort, checkModel, resolveAssignments } from '@agentteam/core/assign';
import { getAgent } from '@agentteam/core/agents';
import { listAgents, saveAuth } from './auth-routes.js';
import { HttpError, readJson, sendJson } from './http-util.js';
import { checkRequest } from './guard.js';
import { serveEvents } from './sse.js';

const MAX_TEXT = 20000;

export function createApp({
  session,
  root,
  credentialsFile,
  allowedHosts = () => null,
  staticHandler = null,
  heartbeatMs = 15000,
}) {
  // 先校验整批，全部合法才写入，避免前几项已写入、后面某项失败的半成品状态。
  async function putRoles(req, res) {
    if (session.isRunning()) throw new HttpError(409, '流程运行中，不能修改角色分配');
    const body = await readJson(req);
    // 读请求体期间可能有运行启动，所以读完后再检查一次。
    if (session.isRunning()) throw new HttpError(409, '流程运行中，不能修改角色分配');
    const entries = Object.entries(body.assignments ?? {});
    if (entries.length === 0) throw new HttpError(400, 'assignments 不能为空');
    const checked = [];
    for (const [role, value] of entries) {
      try {
        if (!ROLES.includes(role)) throw new Error(`未知角色：${role}`);
        const agent = getAgent(value?.agent);
        const model = checkModel(value?.model ?? null);
        const effort = checkEffort(agent.id, value?.effort ?? null);
        checked.push([role, agent.id, model, effort]);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    }
    for (const [role, agentId, model, effort] of checked) {
      await assignRole(root, role, agentId, model, effort);
    }
    return sendJson(res, 200, await resolveAssignments(root));
  }

  async function postMessage(req, res) {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, 'text 不能为空');
    if (text.length > MAX_TEXT) throw new HttpError(400, `text 过长（上限 ${MAX_TEXT} 字）`);
    if (session.isRunning()) throw new HttpError(409, '已有流程在运行，请等它完成，或先请求暂停');
    // 运行可能持续几分钟：立即返回 202，进度与结果经事件流送达。
    // 出错时 Session 已经发出收尾事件，这里只需要防止未处理的 Promise 拒绝。
    session.send(text).catch(() => {});
    return sendJson(res, 202, { accepted: true });
  }

  return async function handle(req, res) {
    try {
      const denied = checkRequest(req, allowedHosts());
      if (denied) return sendJson(res, 403, { error: denied });

      const url = new URL(req.url, 'http://local');
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/state':
          return sendJson(res, 200, await session.state());
        case 'GET /api/roles':
          return sendJson(res, 200, await resolveAssignments(root));
        case 'PUT /api/roles':
          return await putRoles(req, res);
        case 'POST /api/message':
          return await postMessage(req, res);
        case 'POST /api/pause':
          if (!session.isRunning()) throw new HttpError(409, '没有运行中的流程');
          return sendJson(res, 200, { first: session.requestPause() });
        case 'GET /api/agents':
          return sendJson(res, 200, await listAgents(credentialsFile));
        case 'GET /api/events':
          if (!serveEvents(req, res, session.log, { heartbeatMs })) {
            throw new HttpError(400, 'after 必须是非负整数');
          }
          return;
        case 'POST /api/cancel':
          if (!session.isRunning() || !session.cancel()) throw new HttpError(409, '没有运行中的流程');
          return sendJson(res, 200, { cancelled: true });
        default:
      }

      const authMatch = /^\/api\/auth\/([a-z0-9-]+)$/.exec(url.pathname);
      if (authMatch && req.method === 'POST') {
        return sendJson(res, 200, await saveAuth(authMatch[1], await readJson(req), credentialsFile));
      }

      if (url.pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在');
      if (staticHandler && req.method === 'GET') return await staticHandler(req, res, url);
      throw new HttpError(404, '未找到');
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      // 只记录错误信息，不记录请求内容（可能含 API key）。
      console.error('服务内部错误：', err.message);
      return sendJson(res, 500, { error: '服务内部错误' });
    }
  };
}
