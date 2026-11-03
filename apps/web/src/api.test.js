import { test, expect, vi } from 'vitest';
import { apiErrorText, createApi } from './api.js';

function fakeFetch(status, body) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }));
}

test('apiErrorText：优先用服务端的 error，否则按状态码给固定文案', () => {
  expect(apiErrorText(409, { error: '已有流程在运行，请等它完成' })).toBe('已有流程在运行，请等它完成');
  expect(apiErrorText(400, null)).toBe('请求不合法');
  expect(apiErrorText(403, null)).toBe('不允许访问');
  expect(apiErrorText(404, null)).toBe('接口不存在');
  expect(apiErrorText(409, null)).toBe('已有流程在运行');
  expect(apiErrorText(413, null)).toBe('请求内容过大');
  expect(apiErrorText(500, null)).toBe('服务出错');
});

test('成功响应返回 ok 与解析后的 data', async () => {
  const api = createApi(fakeFetch(200, { stage: 'idle', running: false, lastSeq: 0 }));
  expect(await api.fetchState()).toEqual({ ok: true, data: { stage: 'idle', running: false, lastSeq: 0 } });
});

test('202 与空响应体都算成功', async () => {
  const api = createApi(fakeFetch(202, { accepted: true }));
  expect(await api.postMessage('需求')).toEqual({ ok: true, data: { accepted: true } });
  const empty = createApi(fakeFetch(200, undefined));
  expect(await empty.postPause()).toEqual({ ok: true, data: null });
});

test('失败响应带上服务端文案，不抛异常', async () => {
  const api = createApi(fakeFetch(409, { error: '没有运行中的流程' }));
  expect(await api.postCancel()).toEqual({ ok: false, error: '没有运行中的流程' });
});

test('网络错误返回"无法连接服务"', async () => {
  const api = createApi(vi.fn(async () => { throw new Error('offline'); }));
  expect(await api.fetchAgents()).toEqual({ ok: false, error: '无法连接服务' });
});

test('请求路径与请求体符合服务端契约', async () => {
  const fetchImpl = fakeFetch(200, {});
  const api = createApi(fetchImpl);
  await api.putRoles({ qa: { agent: 'claude', model: null, effort: null } });
  await api.postAuth('deepseek', { method: 'api', apiKey: 'sk-test' });
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/roles');
  expect(fetchImpl.mock.calls[0][1].method).toBe('PUT');
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
    assignments: { qa: { agent: 'claude', model: null, effort: null } },
  });
  expect(fetchImpl.mock.calls[1][0]).toBe('/api/auth/deepseek');
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ method: 'api', apiKey: 'sk-test' });
});
