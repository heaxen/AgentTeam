import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { runProcess } from './process.js';

// DeepSeek 适配器（OpenAI 兼容的 chat/completions + 工具调用）。设计见 cli/docs/adapters.md。
// 模型本身不能读写文件，所以这里提供四个工具，由本进程代为执行：
// read_file / write_file / list_dir 只能访问项目根目录内的路径；
// run_command 只能执行 team/allowed-commands.json 中整条匹配的命令。
// 工具执行出错时，错误文本作为工具结果返回给模型，让它自己修正，不中断整个任务。
const BASE_URL = 'https://api.deepseek.com';
const MODEL = 'deepseek-v4-pro';
const MAX_STEPS = 60;
const MAX_OUTPUT = 20000;

// 不允许写入或读取的目录：版本库内部。
const FORBIDDEN_SEGMENT = '.git';

export function resolveInside(root, path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('路径不能为空');
  if (isAbsolute(path)) throw new Error(`只能使用相对项目根目录的路径：${path}`);
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`路径越出项目目录：${path}`);
  }
  if (rel.split(sep).includes(FORBIDDEN_SEGMENT)) throw new Error(`不允许访问 ${FORBIDDEN_SEGMENT} 目录：${path}`);
  return full;
}

function clip(text) {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n……（输出过长，已截断）` : text;
}

export function buildTools(allowedCommands) {
  const pathParam = { type: 'string', description: '相对项目根目录的路径，如 docs/backend/IMPL-001.md' };
  const list = allowedCommands.length ? allowedCommands.join('、') : '（项目未允许任何命令）';
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取项目内的文本文件',
        parameters: { type: 'object', properties: { path: pathParam }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '写入项目内的文件；文件不存在则创建，目录不存在则自动创建',
        parameters: {
          type: 'object',
          properties: { path: pathParam, content: { type: 'string', description: '完整的文件内容' } },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: '列出项目内目录的直接子项，子目录名以 / 结尾',
        parameters: { type: 'object', properties: { path: pathParam }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: `执行一条项目允许的验证命令，只能是下列命令之一（必须整条一致）：${list}`,
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: '要执行的完整命令' } },
          required: ['command'],
        },
      },
    },
  ];
}

async function runTool(name, args, { root, cwd, allowedCommands, timeoutMs }) {
  switch (name) {
    case 'read_file':
      return clip(await readFile(resolveInside(root, args.path), 'utf8'));
    case 'write_file': {
      const full = resolveInside(root, args.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, args.content ?? '', 'utf8');
      return `已写入 ${args.path}`;
    }
    case 'list_dir': {
      const entries = await readdir(resolveInside(root, args.path ?? '.'), { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n') || '（空目录）';
    }
    case 'run_command': {
      const command = String(args.command ?? '').trim();
      if (!allowedCommands.includes(command)) {
        throw new Error(`命令未被项目允许：${command}。允许的命令：${allowedCommands.join('、') || '无'}`);
      }
      const proc = await runProcess({ command, cwd, env: process.env, input: '', timeoutMs });
      const output = `${proc.stdout}${proc.stderr}`;
      return clip(`退出码 ${proc.code}\n${output}`);
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

async function chat({ apiKey, messages, tools, fetchImpl, signal }) {
  const res = await fetchImpl(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools }),
    signal,
  });
  if (!res.ok) throw new Error(`DeepSeek 返回 HTTP ${res.status}：${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error('DeepSeek 返回中没有 message');
  return message;
}

function failure(error, timedOut = false) {
  return { ok: false, text: '', exitCode: null, timedOut, error, stderr: '' };
}

export const deepseekAdapter = {
  id: 'deepseek',
  canEditFiles: true,

  async run({ prompt, cwd, credential = {}, timeoutMs, allowedCommands = [], fetchImpl = fetch }) {
    const apiKey = credential.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return failure('缺少 DeepSeek API key：请运行 agentteam auth deepseek --from-env');

    const deadline = Date.now() + timeoutMs;
    const tools = buildTools(allowedCommands);
    const messages = [{ role: 'user', content: prompt }];
    const toolContext = { root: cwd, cwd, allowedCommands, timeoutMs };

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return failure('执行超时，已终止', true);

        const message = await chat({
          apiKey,
          messages,
          tools,
          fetchImpl,
          signal: AbortSignal.timeout(remaining),
        });
        messages.push(message);

        if (!message.tool_calls?.length) {
          return { ok: true, text: message.content ?? '', exitCode: 0, timedOut: false, stderr: '' };
        }

        for (const call of message.tool_calls) {
          let output;
          try {
            const args = JSON.parse(call.function.arguments || '{}');
            output = await runTool(call.function.name, args, { ...toolContext, timeoutMs: Math.max(1, deadline - Date.now()) });
          } catch (err) {
            output = `错误：${err.message}`;
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        }
      }
      return failure(`超过 ${MAX_STEPS} 步仍未完成`);
    } catch (err) {
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      return failure(timedOut ? '执行超时，已终止' : err.message, timedOut);
    }
  },
};
