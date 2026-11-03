export const ROLE_ORDER = ['req-analyst', 'architect', 'frontend-dev', 'backend-dev', 'qa'];

export const ROLE_NAMES = {
  'req-analyst': '需求与原型',
  architect: '架构师',
  'frontend-dev': '前端开发',
  'backend-dev': '后端开发',
  qa: '测试',
};

export const STAGE_TEXT = {
  idle: '等待需求',
  arch_review: '等待选择方案',
  delivered: '已交付',
  closed: '已取消',
  failed: '步骤失败',
  paused: '已暂停',
};

export const STATUS_TEXT = {
  idle: '等待',
  running: '运行中',
  done: '完成',
  failed: '失败',
  interrupted: '已中断，可重试',
};

export const EMPTY_VIEW = {
  roleState: {},
  outputs: {},
  files: {},
  messages: [],
  lastEvent: null,
};

// 每个角色当前的终态：按事件顺序记录"最后一次见到的事件"，不用计数推导。
// 用计数会在重试时出错：失败一次后重试成功（started 2、failed 1、finished 1）会被判为失败。
export const ROLE_EVENTS = {
  'role.started': 'running',
  'role.finished': 'done',
  'role.failed': 'failed',
};

// running 为 false，但该角色的最后一条事件是 started：
// 服务在角色运行中崩溃或重启后留下的状态（backlog B-007），显示为"已中断，可重试"。
export function isInterrupted({ running, role, roleState }) {
  return !running && roleState[role] === 'running';
}

// 角色状态：最后一次事件决定状态；没有事件就是 idle。
// 注意：构建阶段（选了方案之后）stage 仍然是 arch_review，因为工作流在最后一步才改 stage；
// 所以"正在跑"必须用 running 判断，不能用 stage。
export function roleStatus({ running, role, roleState }) {
  const last = roleState[role];
  if (!last) return 'idle';
  if (last === 'running' && !running) return 'interrupted';
  return last;
}

// 新一轮需求分析开始：req-analyst 重新开跑，且当前没有任何角色在运行。
// 只有这时才清空角色状态——选方案、给意见、继续、重试都会让"需求与原型/架构师"的
// 完成标记不该丢（流水线的意义就是保留进度）。上一轮交付后残留的"完成"在这里被清掉。
function startsNewRound(view, event) {
  if (event.type !== 'role.started' || event.role !== 'req-analyst') return false;
  return !Object.values(view.roleState).includes('running');
}

// 事件 → 视图增量。纯函数，不读时钟、不读外部状态，便于测试。
export function reduceEvents(view, event) {
  let roleState = startsNewRound(view, event) ? {} : view.roleState;
  if (event.role && ROLE_EVENTS[event.type]) {
    roleState = { ...roleState, [event.role]: ROLE_EVENTS[event.type] };
  }

  let outputs = view.outputs;
  if (event.type === 'role.output' && event.role) {
    outputs = { ...outputs, [event.role]: [...(outputs[event.role] ?? []), event.chunk] };
  }

  let files = view.files;
  if (event.type === 'role.files' && event.role) {
    files = { ...files, [event.role]: [...(files[event.role] ?? []), ...event.files] };
  }

  const messages = event.type === 'message' ? [...view.messages, event] : view.messages;

  return { roleState, outputs, files, messages, lastEvent: event };
}
