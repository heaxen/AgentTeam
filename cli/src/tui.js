import { emitKeypressEvents } from 'node:readline';
import { format } from 'node:util';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HISTORY_LIMIT = 500;

// 读取历史文件（每行一条）；文件不存在时返回空历史。
function loadHistory(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-HISTORY_LIMIT);
}

// 终端界面（只在真实终端中使用）：上方是滚动的对话记录，底部固定为
// 工作状态行、输入框和状态栏。只用 ANSI 转义序列，不依赖第三方库。
// 两次绘制之间光标始终停在输入框里；绘制前先回到底部区域顶部，清掉后重画。

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INPUT_ROW_UP = 3; // 从最后一行（状态栏第二行）回到输入框中间行
const TOP_ROW_UP = 2; // 从输入框中间行回到底部区域第一行（工作行）

export function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += isWide(ch.codePointAt(0)) ? 2 : 1;
  return width;
}

function isWide(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

// 按显示宽度截断，超出的部分去掉。
function fit(text, width) {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  return out;
}

// onInterrupt：团队执行中按下 Esc 或 Ctrl+C 时调用，返回要显示的提示文字。
// historyFile：输入历史的保存位置（每行一条）；不传则只在本次会话中保留。
export function createScreen({ input, output, onInterrupt, historyFile }) {
  const history = loadHistory(historyFile);
  let histIndex = null; // 正在翻看的历史位置；null 表示正在编辑新输入
  let draft = []; // 开始翻看历史前的输入，按下键回到最新时恢复
  const chars = []; // 输入框内容，按字符保存
  let cursor = 0;
  let title = ''; // 输入框边框上的标题，即提示语
  let hidden = false; // 输入 key 时不显示内容
  let reader = null; // 当前接收按键的处理函数；为空时按键只编辑输入框，回车不提交
  let menuRows = 0; // 选择列表占用的行数，列表显示期间不绘制底部区域
  let status = { left: '', right: '' };
  let busy = null; // { label, since }
  let frame = 0;
  let timer = null;
  let started = false;
  let lastInterrupt = 0; // 上一次在执行中按下 Ctrl+C 的时间
  let bottomShown = false;
  let wasRaw = false;
  const originalLog = console.log;
  const originalError = console.error;

  // 留出最后一列：整行写满会让终端进入换行等待状态，光标行数就会错位。
  const width = () => (output.columns || 80) - 1;
  const write = (text) => output.write(text);

  // 底部区域存在时，光标在输入框中间行；回到顶部并清除之后的内容。
  function eraseBottom() {
    if (bottomShown) write(`\x1b[${TOP_ROW_UP}A\r\x1b[0J`);
    bottomShown = false;
  }

  // 每次绘制都先清掉上一帧，否则同一个框会一直往下叠加。
  function drawBottom() {
    if (!started || menuRows) return;
    eraseBottom();
    const w = width();
    const work = busy
      ? `${SPINNER[frame % SPINNER.length]} ${busy.label} · ${Math.round((Date.now() - busy.since) / 1000)} 秒`
      : '';
    const rule = '─'.repeat(w);

    // 输入行：提示语 + 内容，内容超出时只显示光标附近的部分。
    const prompt = title ? `${title} ` : '';
    const inner = w - displayWidth(prompt);
    let start = cursor;
    let used = 0;
    while (!hidden && start > 0 && used + displayWidth(chars[start - 1]) < inner) {
      start -= 1;
      used += displayWidth(chars[start]);
    }
    const visible = hidden ? '' : fit(chars.slice(start).join(''), inner);
    const col = displayWidth(prompt) + (hidden ? 0 : displayWidth(chars.slice(start, cursor).join('')));
    const middle = `${prompt}${visible}`;

    const right = fit(status.right, w);
    const lines = [
      work,
      rule,
      middle,
      rule,
      fit(status.left, w),
      ' '.repeat(Math.max(0, w - displayWidth(right))) + right,
    ];
    write(lines.map((line) => `${fit(line, w)}\x1b[0K`).join('\r\n'));
    write(`\x1b[${INPUT_ROW_UP}A\r\x1b[${col}C`);
    bottomShown = true;
  }

  // 在对话记录区域输出文字：先收起底部区域，输出后重新绘制。
  function print(text) {
    eraseBottom();
    const body = String(text).replace(/\r?\n/g, '\r\n');
    write(body.endsWith('\r\n') ? body : `${body}\r\n`);
    drawBottom();
  }

  // 编辑输入框。返回 false 表示这个按键不属于编辑操作。
  function edit(str, key) {
    if (key.name === 'left') cursor = Math.max(0, cursor - 1);
    else if (key.name === 'right') cursor = Math.min(chars.length, cursor + 1);
    else if (key.name === 'home') cursor = 0;
    else if (key.name === 'end') cursor = chars.length;
    else if (key.name === 'backspace') {
      if (cursor > 0) {
        chars.splice(cursor - 1, 1);
        cursor -= 1;
      }
    } else if (key.name === 'delete') chars.splice(cursor, 1);
    else if (key.ctrl && key.name === 'u') {
      chars.splice(0, cursor);
      cursor = 0;
    } else if (str && !key.ctrl && !key.meta && str >= ' ' && str !== '\x7f') {
      const added = Array.from(str);
      chars.splice(cursor, 0, ...added);
      cursor += added.length;
    } else return false;
    drawBottom();
    return true;
  }

  // 把输入框内容整体换成 text，光标放到末尾。
  function setInput(text) {
    chars.length = 0;
    chars.push(...Array.from(text));
    cursor = chars.length;
  }

  // Tab 补全：唯一候选时补全并加一个空格；有多个候选时补到公共前缀，并列出候选。
  function complete(candidates) {
    if (candidates.length === 1) return setInput(`${candidates[0]} `);
    if (candidates.length === 0) return;
    let prefix = Array.from(candidates[0]);
    for (const c of candidates.slice(1)) {
      const other = Array.from(c);
      let i = 0;
      while (i < prefix.length && i < other.length && prefix[i] === other[i]) i += 1;
      prefix = prefix.slice(0, i);
    }
    if (prefix.length > chars.length) setInput(prefix.join(''));
    print(candidates.join('    '));
  }

  // 读取一行。secret 为 true 时不显示输入内容，也不回显到记录里。
  // cancelable 为 true 时，Esc 或 Ctrl+C 先清空已输入的内容；输入为空时返回 "取消"。
  // remember 为 true 时，输入会进入历史（上下键可以找回）；completer(文字) 返回 Tab 补全的候选。
  function line(question, { secret = false, cancelable = false, remember = false, completer = null } = {}) {
    return new Promise((resolve) => {
      title = question.trim();
      hidden = secret;
      const finish = (value, echo) => {
        reader = null;
        chars.length = 0;
        cursor = 0;
        title = '';
        hidden = false;
        histIndex = null;
        if (echo === undefined) drawBottom();
        else print(echo);
        resolve(value);
      };
      reader = (str, key) => {
        if (cancelable && (key.name === 'escape' || (key.ctrl && key.name === 'c'))) {
          if (chars.length) {
            chars.length = 0;
            cursor = 0;
            return drawBottom();
          }
          return finish('取消');
        }
        if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(null);
        if (key.name === 'return' || key.name === 'enter') {
          const text = chars.join('').trim();
          if (remember && !secret) addHistory(text);
          return finish(text, secret ? undefined : `${question}${text}`);
        }
        if (remember && key.name === 'up') {
          if (!history.length) return;
          if (histIndex === null) {
            draft = chars.slice();
            histIndex = history.length;
          }
          histIndex = Math.max(0, histIndex - 1);
          setInput(history[histIndex]);
          return drawBottom();
        }
        if (remember && key.name === 'down') {
          if (histIndex === null) return;
          histIndex += 1;
          if (histIndex >= history.length) {
            histIndex = null;
            chars.length = 0;
            chars.push(...draft);
            cursor = chars.length;
          } else setInput(history[histIndex]);
          return drawBottom();
        }
        if (completer && key.name === 'tab') {
          complete(completer(chars.join('')));
          return drawBottom();
        }
        if (key.name !== 'up' && key.name !== 'down') histIndex = null;
        edit(str, key);
      };
      drawBottom();
    });
  }

  // 记入历史：去掉与上一条相同的内容，最多保留 HISTORY_LIMIT 条，并写入历史文件。
  function addHistory(text) {
    if (!text || history[history.length - 1] === text) return;
    history.push(text);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    if (historyFile) {
      try {
        mkdirSync(dirname(historyFile), { recursive: true });
        appendFileSync(historyFile, `${text.replace(/\r?\n/g, ' ')}\n`, 'utf8');
      } catch {
        // 历史文件写不了不影响对话
      }
    }
  }

  // 上下键选择，也可以直接输入编号后回车。返回所选下标；Ctrl+C 返回 null。
  function select({ title: heading, labels }) {
    return new Promise((resolve) => {
      eraseBottom();
      const rows = labels.length + 2; // 标题 + 选项 + 提示行
      menuRows = rows;
      let index = 0;
      let typed = '';

      const draw = (redraw) => {
        if (redraw) write(`\x1b[${rows}A\x1b[0J`);
        write(`${fit(heading, width())}\r\n`);
        labels.forEach((label, i) => write(`${fit(`${i === index ? '›' : ' '} ${i + 1}. ${label}`, width())}\r\n`));
        write(`${fit(`↑↓ 选择，回车确认；也可直接输入编号${typed ? `（${typed}）` : ''}`, width())}\r\n`);
      };

      const close = (value) => {
        reader = null;
        write(`\x1b[${rows}A\x1b[0J`);
        menuRows = 0;
        if (value === null) drawBottom();
        else print(`${heading} ${labels[value]}`);
        resolve(value);
      };

      reader = (str, key) => {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return close(null);
        if (key.name === 'return' || key.name === 'enter') return close(index);
        if (key.name === 'up') index = (index - 1 + labels.length) % labels.length;
        else if (key.name === 'down') index = (index + 1) % labels.length;
        else if (key.name === 'backspace') typed = typed.slice(0, -1);
        else if (/^[0-9]$/.test(str ?? '')) {
          const next = Number(typed + str);
          const single = Number(str);
          if (next >= 1 && next <= labels.length) {
            typed += str;
            index = next - 1;
          } else if (single >= 1 && single <= labels.length) {
            typed = str;
            index = single - 1;
          } else {
            typed = '';
          }
        } else return;
        draw(true);
      };

      draw(false);
    });
  }

  function onKey(str, key = {}) {
    if (reader) return reader(str, key);
    // 团队执行中不中断当前角色（会留下写了一半的文件），只请求暂停：当前角色结束后停下。
    // 连按两次 Ctrl+C 才强制退出。
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      if (key.ctrl && key.name === 'c' && Date.now() - lastInterrupt < 2000) {
        stop();
        process.exit(130);
      }
      lastInterrupt = Date.now();
      print(onInterrupt ? onInterrupt() : '执行中无法取消，等本步结束后再取消；连按两次 Ctrl+C 强制退出。');
      return;
    }
    // 没有等待输入时仍可以编辑输入框（例如团队执行时提前写下一句），但回车不提交。
    edit(str, key);
  }

  function setBusy(label) {
    busy = label ? { label, since: Date.now() } : null;
    clearInterval(timer);
    timer = null;
    if (busy) {
      timer = setInterval(() => {
        frame += 1;
        drawBottom();
      }, 200);
    }
    drawBottom();
  }

  function setStatus(next) {
    status = next;
    drawBottom();
  }

  function start() {
    if (started) return;
    emitKeypressEvents(input);
    wasRaw = input.isRaw;
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
    started = true;
    // 其他代码里的 console.log 也输出到对话记录区域，避免破坏底部区域。
    console.log = (...args) => print(format(...args));
    console.error = (...args) => print(format(...args));
    drawBottom();
  }

  function stop() {
    if (!started) return;
    started = false;
    clearInterval(timer);
    timer = null;
    eraseBottom();
    console.log = originalLog;
    console.error = originalError;
    input.removeListener('keypress', onKey);
    input.setRawMode(wasRaw);
    input.pause();
  }

  return { start, stop, line, select, print, setBusy, setStatus };
}
