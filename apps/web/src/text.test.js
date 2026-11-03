import { test, expect } from 'vitest';
import { isInterrupted, roleStatus, reduceEvents, EMPTY_VIEW } from './text.js';

function apply(events) {
  return events.reduce((view, event) => reduceEvents(view, event), EMPTY_VIEW);
}

test('role.output 逐条累积，不丢片段', () => {
  const view = apply([
    { seq: 1, type: 'role.output', role: 'architect', chunk: '第一段' },
    { seq: 2, type: 'role.output', role: 'architect', chunk: '第二段' },
  ]);
  expect(view.outputs.architect).toEqual(['第一段', '第二段']);
});

test('role.files 与 message 分别累积', () => {
  const view = apply([
    { seq: 1, type: 'role.files', role: 'backend-dev', files: ['docs/backend/IMPL-001.md'] },
    { seq: 2, type: 'role.files', role: 'backend-dev', files: ['src/app.js'] },
    { seq: 3, type: 'message', from: 'user', text: '做个登录' },
    { seq: 4, type: 'message', from: 'team', text: '已交付' },
  ]);
  expect(view.files['backend-dev']).toEqual(['docs/backend/IMPL-001.md', 'src/app.js']);
  expect(view.messages.map((m) => m.from)).toEqual(['user', 'team']);
});

test('中断：最后一条事件是 started，且当前不在运行', () => {
  expect(isInterrupted({ running: false, role: 'qa', roleState: { qa: 'running' } })).toBe(true);
  expect(isInterrupted({ running: true, role: 'qa', roleState: { qa: 'running' } })).toBe(false);
  expect(isInterrupted({ running: false, role: 'qa', roleState: { qa: 'done' } })).toBe(false);
  expect(isInterrupted({ running: false, role: 'qa', roleState: { qa: 'failed' } })).toBe(false);
  expect(isInterrupted({ running: false, role: 'qa', roleState: {} })).toBe(false);
});

test('角色状态：空闲、运行中、完成、失败、中断', () => {
  expect(roleStatus({ running: false, role: 'qa', roleState: {} })).toBe('idle');
  expect(roleStatus({ running: true, role: 'qa', roleState: { qa: 'running' } })).toBe('running');
  expect(roleStatus({ running: false, role: 'qa', roleState: { qa: 'done' } })).toBe('done');
  expect(roleStatus({ running: false, role: 'qa', roleState: { qa: 'failed' } })).toBe('failed');
  expect(roleStatus({ running: false, role: 'qa', roleState: { qa: 'running' } })).toBe('interrupted');
});

test('失败后重试成功：状态由最后一条事件决定，不残留失败', () => {
  const view = apply([
    { seq: 1, type: 'role.started', role: 'qa', agent: 'claude' },
    { seq: 2, type: 'role.failed', role: 'qa', error: '第一步失败' },
    { seq: 3, type: 'role.started', role: 'qa', agent: 'claude' },
    { seq: 4, type: 'role.finished', role: 'qa' },
  ]);
  expect(roleStatus({ running: false, role: 'qa', roleState: view.roleState })).toBe('done');
});

test('新一轮需求分析开始时清空角色状态，但保留已累积的输出与产物', () => {
  const view = apply([
    { seq: 1, type: 'role.started', role: 'req-analyst', agent: 'claude' },
    { seq: 2, type: 'role.finished', role: 'req-analyst' },
    { seq: 3, type: 'role.started', role: 'architect', agent: 'claude' },
    { seq: 4, type: 'role.finished', role: 'architect' },
    { seq: 5, type: 'role.output', role: 'architect', chunk: '上一轮的输出' },
    { seq: 6, type: 'role.started', role: 'req-analyst', agent: 'claude' },
  ]);
  expect(view.roleState).toEqual({ 'req-analyst': 'running' });
  expect(view.outputs.architect).toEqual(['上一轮的输出']);
});

test('选方案不丢已完成角色的标记', () => {
  const view = apply([
    { seq: 1, type: 'role.started', role: 'req-analyst', agent: 'claude' },
    { seq: 2, type: 'role.finished', role: 'req-analyst' },
    { seq: 3, type: 'role.started', role: 'architect', agent: 'claude' },
    { seq: 4, type: 'role.finished', role: 'architect' },
    { seq: 5, type: 'message', from: 'user', text: 'A' },
    { seq: 6, type: 'role.started', role: 'backend-dev', agent: 'claude' },
  ]);
  expect(view.roleState).toEqual({ 'req-analyst': 'done', architect: 'done', 'backend-dev': 'running' });
});

test('reduceEvents 不改动传入的 view', () => {
  const view = EMPTY_VIEW;
  reduceEvents(view, { seq: 1, type: 'role.output', role: 'qa', chunk: 'x' });
  expect(view.outputs).toEqual({});
  expect(view.roleState).toEqual({});
});
