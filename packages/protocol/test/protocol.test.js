import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, EVENT_FIELDS, makeEvent, validateEvent } from '../src/index.js';

// 协议只增不减：下面是已发布的事件与必填字段。以后可以新增事件、新增字段，不能删除或改名。
const PUBLISHED = {
  'stage.changed': ['stage'],
  'role.started': ['role', 'agent'],
  'role.output': ['role', 'chunk'],
  'role.files': ['role', 'files'],
  'role.finished': ['role'],
  'role.failed': ['role', 'error'],
  message: ['from', 'text'],
};

test('已发布的事件类型与必填字段不会被删除', () => {
  for (const [type, fields] of Object.entries(PUBLISHED)) {
    assert.ok(type in EVENT_FIELDS, `缺少事件类型 ${type}`);
    for (const field of fields) {
      assert.ok(EVENT_FIELDS[type].includes(field), `${type} 缺少必填字段 ${field}`);
    }
  }
});

test('makeEvent 生成带版本、序号、时间的事件', () => {
  const event = makeEvent('role.output', { role: 'qa', chunk: '你好' }, { seq: 3, time: '2026-11-02T00:00:00.000Z' });
  assert.deepEqual(event, {
    role: 'qa',
    chunk: '你好',
    v: PROTOCOL_VERSION,
    seq: 3,
    time: '2026-11-02T00:00:00.000Z',
    type: 'role.output',
  });
});

test('业务数据不能覆盖 v、seq、time、type', () => {
  const event = makeEvent('role.finished', { role: 'qa', seq: 99, v: 99, type: 'x' }, { seq: 1 });
  assert.equal(event.seq, 1);
  assert.equal(event.v, PROTOCOL_VERSION);
  assert.equal(event.type, 'role.finished');
});

test('缺必填字段、未知类型、坏序号、坏版本都会被拒绝', () => {
  assert.throws(() => makeEvent('role.failed', { role: 'qa' }, { seq: 1 }), /role\.failed 缺少字段 error/);
  assert.throws(() => makeEvent('nope', {}, { seq: 1 }), /未知事件类型/);
  assert.throws(() => makeEvent('role.finished', { role: 'qa' }, { seq: 0 }), /seq/);
  assert.throws(() => validateEvent({ v: 2, seq: 1, time: new Date().toISOString(), type: 'role.finished', role: 'qa' }), /协议版本/);
  assert.throws(() => validateEvent(null), /对象/);
});

test('继承来的属性名（如 toString）按未知事件类型处理，不抛 TypeError', () => {
  assert.throws(() => makeEvent('toString', {}, { seq: 1 }), /未知事件类型/);
  assert.throws(() => makeEvent('constructor', {}, { seq: 1 }), /未知事件类型/);
});

test('多出来的字段不影响校验（旧客户端可以忽略新字段）', () => {
  const event = makeEvent('role.started', { role: 'qa', agent: 'claude', model: null, future: 1 }, { seq: 2 });
  assert.equal(event.future, 1);
});

test('makeEvent 缺少 seq 时给出明确错误', () => {
  assert.throws(() => makeEvent('role.finished', { role: 'x' }), /makeEvent 需要 \{ seq \}/);
  assert.throws(() => makeEvent('role.finished', { role: 'x' }, {}), /makeEvent 需要 \{ seq \}/);
});
