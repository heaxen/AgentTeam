import { createEventLog } from './store/events.js';
import { handleMessage, loadState } from './workflow.js';
import { dispatchTask } from './dispatch.js';
import { resolveAssignments } from './assign.js';

export class BusyError extends Error {
  constructor() {
    super('已有流程在运行，请等它完成，或先请求暂停');
    this.name = 'BusyError';
  }
}

// 每个项目目录一个会话：持有自己的事件日志、暂停标志和"是否在运行"。
// 取代 workflow.js 里的模块级暂停变量，这样一个服务可以同时管理多个项目而互不干扰。
export async function createSession({ root, dispatch = dispatchTask }) {
  const log = await createEventLog(root);
  let running = false;
  let pause = false;
  let controller = null;

  // 包一层派发：把角色的开始、实时输出、产物、结果变成事件，工作流本身不需要知道事件的存在。
  async function observedDispatch(args) {
    const { role } = args;
    const assigned = (await resolveAssignments(root).catch(() => ({})))[role] ?? {};
    log.emit('role.started', {
      role,
      agent: assigned.agent ?? 'unknown',
      model: assigned.model ?? null,
      effort: assigned.effort ?? null,
    });
    let result;
    try {
      // 适配器的流处理回调里不能抛错：只接受非空字符串，发事件失败也吞掉。
      const onOutput = (chunk) => {
        if (typeof chunk !== 'string' || chunk === '') return;
        try {
          log.emit('role.output', { role, chunk });
        } catch {
          // 丢掉这一段输出，不影响派发。
        }
      };
      result = await dispatch({ ...args, onOutput, signal: controller?.signal });
    } catch (err) {
      // 派发前的检查（未认证、未分配等）会抛错：工作流会把它转成可重试的失败步骤，这里只负责留下事件。
      log.emit('role.failed', { role, error: err.message });
      throw err;
    }
    log.emit('role.files', { role, files: result.changed ?? [] });
    if (result.ok) log.emit('role.finished', { role });
    else log.emit('role.failed', { role, error: result.error ?? '未知错误' });
    return result;
  }

  return {
    log,

    async send(text) {
      if (running) throw new BusyError();
      running = true;
      pause = false;
      controller = new AbortController();
      try {
        log.emit('message', { from: 'user', text });
        const reply = await handleMessage({
          root,
          text,
          deps: { dispatch: observedDispatch, shouldPause: () => pause },
        });
        const stage = reply.stage ?? (await loadState(root)).stage ?? 'idle';
        log.emit('message', { from: 'team', text: reply.text ?? '' });
        log.emit('stage.changed', { stage });
        return reply;
      } catch (err) {
        // 工作流本身出错：也要给客户端一个收尾记录，抛出的仍是原始错误。
        try {
          const stage = (await loadState(root)).stage ?? 'idle';
          log.emit('message', { from: 'team', text: `执行出错：${err?.message ?? err}` });
          log.emit('stage.changed', { stage });
        } catch {
          // 收尾失败不能盖掉原始错误。
        }
        throw err;
      } finally {
        controller = null;
        running = false;
      }
    },

    // 取消运行中的流程：强制终止当前角色的进程。同时置暂停标志，避免它结束后工作流继续往下走。
    cancel() {
      if (!running || !controller) return false;
      pause = true;
      controller.abort();
      return true;
    },

    isRunning() {
      return running;
    },

    // 返回是否为本次运行的首次请求（界面据此决定提示文字）。
    requestPause() {
      const first = !pause;
      pause = true;
      return first;
    },

    async state() {
      // 先快照 running 与 lastSeq，再读状态文件：读取期间发出的事件不能让 lastSeq 比 stage 更新。
      const snapshot = { running, lastSeq: log.lastSeq };
      return { ...(await loadState(root)), ...snapshot };
    },
  };
}
