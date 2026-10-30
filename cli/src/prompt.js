import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createScreen } from './tui.js';

// 统一的输入会话：整个对话或命令只用一个输入会话。
// 终端中使用 tui.js（底部输入框 + 状态栏，支持上下键选择）；
// 管道与测试中使用 readline，行由异步迭代器缓冲，不会因为处理中而丢行。
// secret() 输入时不回显，用于粘贴 API key。输入结束时返回 null。
// 选择界面：AGENTTEAM_UI=tui 或 plain 可强制指定。
// Git Bash（MSYS/mintty）下 TUI 的光标重绘不可靠，改用行输入；有 WT_SESSION 的 Windows Terminal 仍用 TUI。
export function chooseUi(input, env = process.env) {
  if (!input.isTTY) return 'plain';
  if (env.AGENTTEAM_UI === 'tui' || env.AGENTTEAM_UI === 'plain') return env.AGENTTEAM_UI;
  if (env.MSYSTEM && !env.WT_SESSION) return 'plain';
  return 'tui';
}

export function createPrompt({ input = process.stdin, output = process.stdout, onInterrupt, historyFile } = {}) {
  if (chooseUi(input) === 'tui') return createTerminalPrompt({ input, output, onInterrupt, historyFile });

  let muted = false;
  const screen = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  screen.isTTY = output.isTTY;
  Object.defineProperty(screen, 'columns', { get: () => output.columns });

  const rl = createInterface({ input, output: screen, terminal: Boolean(input.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  const read = async () => {
    const next = await lines.next();
    return next.done ? null : next.value.trim();
  };

  return {
    async line(question) {
      output.write(question);
      return read();
    },
    async secret(question) {
      output.write(question);
      muted = true;
      try {
        const value = await read();
        output.write('\n');
        return value;
      } finally {
        muted = false;
      }
    },
    print(text) {
      output.write(text.endsWith('\n') ? text : `${text}\n`);
    },
    setBusy() {},
    setStatus() {},
    close() {
      rl.close();
    },
  };
}

function createTerminalPrompt({ input, output, onInterrupt, historyFile }) {
  const screen = createScreen({ input, output, onInterrupt, historyFile });
  screen.start();
  return {
    line: (question, options) => screen.line(question, options),
    secret: (question) => screen.line(question, { secret: true }),
    select: (options) => screen.select(options),
    print: (text) => screen.print(text),
    setBusy: (label) => screen.setBusy(label),
    setStatus: (status) => screen.setStatus(status),
    close: () => screen.stop(),
  };
}
