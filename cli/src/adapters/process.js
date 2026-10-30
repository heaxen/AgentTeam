import { spawn } from 'node:child_process';

// 运行外部 agent 命令并收集输出。
// command 只能是适配器拼好的固定字符串，其中的参数只来自白名单（见 assertSafeToken）。
// 用户内容一律经 input（stdin）传入，不拼进命令行。
// shell: true 是为了能启动 Windows 上的 .cmd 包装（如 claude.cmd）。
export function runProcess({ command, cwd, env, input = '', timeoutMs }) {
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

    child.stdout.on('data', (d) => (stdout += d));
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
