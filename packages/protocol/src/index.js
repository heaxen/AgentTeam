// 所有客户端（Web、将来的 APP 与小程序）共用的事件协议。
// 只增不减：可以新增事件类型、给事件新增字段，不能删除或改名；不兼容变化才升 PROTOCOL_VERSION。
export const PROTOCOL_VERSION = 1;

// 每种事件必须带的业务字段。新增字段不要放进来，这样旧版本的发送方仍然合法。
export const EVENT_FIELDS = {
  'stage.changed': ['stage'],
  'role.started': ['role', 'agent'],
  'role.output': ['role', 'chunk'],
  'role.files': ['role', 'files'],
  'role.finished': ['role'],
  'role.failed': ['role', 'error'],
  message: ['from', 'text'],
};

export function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('事件必须是对象');
  if (event.v !== PROTOCOL_VERSION) throw new Error(`不支持的协议版本：${event.v}`);
  if (!Number.isInteger(event.seq) || event.seq < 1) throw new Error(`seq 必须是正整数：${event.seq}`);
  if (typeof event.time !== 'string' || Number.isNaN(Date.parse(event.time))) {
    throw new Error(`time 不是有效时间：${event.time}`);
  }
  // 用 hasOwn：type 为 'toString' 之类的继承属性名时，要报"未知事件类型"，不能取到原型上的函数。
  const fields = Object.hasOwn(EVENT_FIELDS, event.type) ? EVENT_FIELDS[event.type] : undefined;
  if (!fields) throw new Error(`未知事件类型：${event.type}`);
  for (const field of fields) {
    if (event[field] === undefined) throw new Error(`${event.type} 缺少字段 ${field}`);
  }
  return event;
}

// 业务数据放在前面展开，保证 v、seq、time、type 不会被它覆盖。
export function makeEvent(type, data, { seq, time = new Date().toISOString() } = {}) {
  if (seq === undefined) throw new Error('makeEvent 需要 { seq }');
  return validateEvent({ ...data, v: PROTOCOL_VERSION, seq, time, type });
}
