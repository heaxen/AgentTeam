import { test, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, StoreProvider } from '../store.jsx';
import Settings from './Settings.jsx';

const ROLES = {
  'req-analyst': { agent: 'claude', model: null, effort: null },
  architect: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  'frontend-dev': { agent: 'claude', model: null, effort: null },
  'backend-dev': { agent: 'claude', model: null, effort: null },
  qa: { agent: 'claude', model: null, effort: null },
};

const AGENTS = [
  { id: 'claude', name: 'Claude Code', kind: 'cli', models: ['claude-opus-5-5', 'claude-sonnet-5-5'], efforts: ['low', 'high'], authenticated: true },
  { id: 'deepseek', name: 'DeepSeek API', kind: 'api', models: ['deepseek-flash'], efforts: ['off', 'high'], authenticated: false },
];

async function setup(running = false) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
    if (url === '/api/roles' && method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify(ROLES) };
    if (url === '/api/agents') return { ok: true, status: 200, text: async () => JSON.stringify(AGENTS) };
    if (url === '/api/roles' && method === 'PUT') return { ok: true, status: 200, text: async () => JSON.stringify(ROLES) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ agent: 'x', authenticated: true }) };
  }));
  const store = createStore({ fetchState: async () => ({ ok: true, data: { stage: 'idle', running, lastSeq: 0 } }) });
  render(<StoreProvider store={store}><Settings /></StoreProvider>);
  await act(() => store.refresh());
  return { calls, store };
}

beforeEach(() => vi.unstubAllGlobals());

test('加载后显示五个角色与当前分配', async () => {
  await setup();
  expect(await screen.findByText('需求与原型')).toBeInTheDocument();
  expect(screen.getByText(/claude-opus-5-5/)).toBeInTheDocument();
  expect(screen.getAllByText('已认证').length).toBeGreaterThan(0);
  expect(screen.getByText('未认证')).toBeInTheDocument();
});

test('修改角色：展开编辑、改模型与强度、保存发出 PUT /api/roles', async () => {
  const { calls } = await setup();
  await screen.findByText('架构师');
  await userEvent.click(screen.getAllByRole('button', { name: '修改' })[1]);
  await userEvent.selectOptions(screen.getByLabelText('模型'), 'claude-sonnet-5-5');
  await userEvent.selectOptions(screen.getByLabelText('强度'), 'high');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  const put = calls.find((c) => c.method === 'PUT');
  expect(put.body.assignments.architect).toEqual({ agent: 'claude', model: 'claude-sonnet-5-5', effort: 'high' });
});

test('API 型 agent 用密码输入框保存 key，页面不回显 key', async () => {
  const { calls } = await setup();
  await screen.findByText('DeepSeek API');
  await userEvent.click(screen.getByRole('button', { name: '填写 API key' }));
  const input = screen.getByLabelText('DeepSeek API 的 API key');
  expect(input).toHaveAttribute('type', 'password');
  await userEvent.type(input, 'sk-test-123');
  await userEvent.click(screen.getByRole('button', { name: '保存 key' }));
  const post = calls.find((c) => c.url === '/api/auth/deepseek');
  expect(post.body).toEqual({ method: 'api', apiKey: 'sk-test-123' });
  expect(screen.queryByDisplayValue('sk-test-123')).toBeNull();
});

test('订阅型 agent 点确认发出 confirm', async () => {
  const { calls } = await setup();
  await screen.findByText('Claude Code');
  await userEvent.click(screen.getAllByRole('button', { name: '确认已登录' })[0]);
  const post = calls.find((c) => c.url === '/api/auth/claude');
  expect(post.body).toEqual({ method: 'confirm' });
});

test('运行中禁用修改', async () => {
  await setup(true);
  await screen.findByText('架构师');
  expect(screen.getAllByRole('button', { name: '修改' })[0]).toBeDisabled();
  expect(screen.getByText('流程运行中，不能修改角色分配。')).toBeInTheDocument();
});
