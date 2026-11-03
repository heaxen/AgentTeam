// 相对路径：开发时经 vite.config.js 的 /api 代理到 127.0.0.1:4317，
// 生产时由 packages/server 同源托管。
const BASE = '/api';

export function apiErrorText(status, body) {
  if (body?.error) return body.error;
  if (status === 400) return '请求不合法';
  if (status === 403) return '不允许访问';
  if (status === 404) return '接口不存在';
  if (status === 409) return '已有流程在运行';
  if (status === 413) return '请求内容过大';
  return '服务出错';
}

export function createApi(fetchImpl) {
  async function request(path, options = {}) {
    // 调用时再取 fetch：模块加载后测试会用 vi.stubGlobal 替换全局 fetch，这里必须能拿到替身。
    const doFetch = fetchImpl ?? globalThis.fetch;
    let res;
    try {
      res = await doFetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
    } catch {
      return { ok: false, error: '无法连接服务' };
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // 非 JSON 响应：按状态码给固定文案
    }
    if (!res.ok) return { ok: false, error: apiErrorText(res.status, body) };
    return { ok: true, data: body };
  }

  return {
    fetchState: () => request('/state'),
    fetchRoles: () => request('/roles'),
    putRoles: (assignments) => request('/roles', { method: 'PUT', body: JSON.stringify({ assignments }) }),
    fetchAgents: () => request('/agents'),
    postMessage: (text) => request('/message', { method: 'POST', body: JSON.stringify({ text }) }),
    postPause: () => request('/pause', { method: 'POST' }),
    postCancel: () => request('/cancel', { method: 'POST' }),
    postAuth: (agentId, body) => request(`/auth/${agentId}`, { method: 'POST', body: JSON.stringify(body) }),
  };
}

const defaultApi = createApi();

export const {
  fetchState, fetchRoles, putRoles, fetchAgents, postMessage, postPause, postCancel, postAuth,
} = defaultApi;
