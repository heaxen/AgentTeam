import { spawn } from 'node:child_process';

// 运行外部 agent 命令并收集输出。
// command 只能是适配器拼好的固定字符串，其中的参数只来自白名单（见 assertSafeToken）。
// 用户内容一律经 input（stdin）传入，不拼进命令行。
// shell: true 是为了能启动 Windows 上的 .cmd 包装（如 claude.cmd）。
export function runProcess({ command, cwd, env, input = '', timeoutMs, onChunk }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // 不等 close：被杀掉的子进程可能仍占着管道，等它关闭会无限期挂起。
      resolve({ code: null, stdout, stderr, timedOut });
    }, timeoutMs);

    // 先设编码再挂监听：多字节字符被切在两段之间时，解码器会拼好，不会产生乱码。
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
      // 回调出错不能影响进程执行和结果。
      try {
        onChunk?.(d);
      } catch {
        // 忽略
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    // agent 提前退出时写入 stdin 会报 EPIPE，结果以退出码为准，这里忽略。
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// shell 包装进程被杀掉时，它启动的 agent 可能仍在运行，因此要连同子进程树一起结束。
function killTree(child) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// 模型名、输出文件名等进入命令行的值，只允许字母、数字和 . _ - /
// 注意：不允许空格和引号，避免 shell 注入。
export function assertSafeToken(value, label) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`${label} 含非法字符：${value}`);
  }
  return value;
}

// 临时文件路径可能含 Windows 的盘符与反斜杠，因此只禁止会破坏引号的字符，并整体加引号。
export function quotePath(path, label) {
  if (/["`$&|;<>]/.test(path)) {
    throw new Error(`${label} 含非法字符：${path}`);
  }
  return `"${path}"`;
}

// 把一次进程执行的结果整理成适配器统一的返回值。
export function toRunResult({ code, stderr, timedOut }, text, errorMessage) {
  const ok = !timedOut && code === 0 && !errorMessage;
  let error = errorMessage;
  if (!error && timedOut) error = '执行超时，已终止';
  if (!error && code !== 0) error = `退出码 ${code}`;
  return { ok, text: ok ? text : '', exitCode: code, timedOut, error: ok ? undefined : error, stderr: stderr.trim() };
}

// 把任意切分的文本拼成完整的行（agent 的流式输出按行给出 JSON，但管道不保证按行到达）。
export function lineSplitter(onLine) {
  let buffer = '';
  const emit = (line) => {
    const trimmed = line.trim();
    if (trimmed) onLine(trimmed);
  };
  return {
    push(text) {
      buffer += text;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        emit(line);
      }
    },
    end() {
      const rest = buffer;
      buffer = '';
      emit(rest);
    },
  };
}

// 适配器的过程输出可能有，也可能没有（取决于 agent 是否在运行中往 stdout 写内容）。
// 过程中收到过输出就不再重复发最终文本；一次都没收到，结束时补发整段，保证界面不是空的。
// 回调抛错一律吞掉，不影响运行结果。
export function trackOutput(onOutput) {
  let seen = false;
  return {
    onChunk: onOutput
      ? (text) => {
          seen = true;
          try {
            onOutput(text);
          } catch {
            // 忽略
          }
        }
      : undefined,
    finish(text) {
      if (onOutput && !seen && text) {
        try {
          onOutput(text);
        } catch {
          // 忽略
        }
      }
    },
  };
}
