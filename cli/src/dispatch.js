import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { getAgent } from './agents.js';
import { ROLES, resolveAssignments } from './assign.js';
import { getAdapter } from './adapters/index.js';
import { loadCredentials } from './credentials.js';
import { loadAllowedCommands } from './allowlist.js';

// 派发一个任务给某个角色：读任务卡与角色说明书 → 组装提示词 → 交给该角色分配的 agent 执行 → 留痕。
// 设计见 cli/docs/adapters.md。

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

// 扫描文件时跳过的目录：依赖、版本库，以及运行记录本身（否则每次运行都会被算作改动）。
const SKIPPED = new Set(['.git', 'node_modules', join('team', 'runs')]);

export function assertTaskId(taskId) {
  if (!/^T-\d{3,}$/.test(taskId ?? '')) {
    throw new Error(`任务号格式应为 T-NNN（如 T-001），收到：${taskId}`);
  }
}

export function assertRole(role) {
  if (!ROLES.includes(role)) {
    throw new Error(`未知角色：${role}（可选：${ROLES.join('、')}）`);
  }
}

// 旧版本（0.4.0）只写了 loggedInAt 或 apiKey，没有 method。这里按已有字段推断，保证兼容。
export function effectiveCredential(credential = {}) {
  const method = credential.method ?? (credential.apiKey ? 'api' : credential.loggedInAt ? 'subscription' : undefined);
  return { ...credential, method };
}

export function checkCredential(agent, credential) {
  if (!credential.method) {
    throw new Error(
      `${agent.name} 尚未认证：订阅请运行 agentteam auth ${agent.id}；个人 API 请先设置环境变量后运行 agentteam auth ${agent.id} --from-env`,
    );
  }
  if (credential.method === 'api' && !credential.apiKey) {
    throw new Error(`${agent.name} 的 API 认证缺少 key：请运行 agentteam auth ${agent.id} --from-env`);
  }
}

export function buildPrompt({ role, taskId, taskText, roleText }) {
  return [
    `你是本项目的【${role}】角色，本次只执行任务 ${taskId}。`,
    '',
    '开工前按顺序读取（顺序不可颠倒）：',
    '1. AGENTS.md（团队公约）',
    '2. AI开发团队角色与协作流程.md（手册）',
    '3. 下方任务卡"适用档案"写明的技术栈档案',
    '',
    '硬性要求：',
    '- 所有产物必须写入磁盘的约定路径；只写在回复里的内容视为不存在。',
    '- 只写本角色自己的目录。发现别人的问题只记录到 docs/messages/，不要修改别人的文件。',
    '- 档案缺失或关键字段为空时，立即停止并在回复中说明，不要猜测技术栈。',
    '- 需要运行验证命令时，只能使用项目允许的命令（见 team/allowed-commands.json）；不要尝试其他命令。',
    '- 完成后在回复末尾按公约第 9 节的 7 字段模板回传：【任务】【门禁自检】【改动文件】【自测】【遗留问题】【需要谁配合】【风险】。',
    '- 回传时另起一段"已读文件"，逐条列出你实际打开过的文件路径。没有读过的文件不要列，也不要声称已读。',
    '',
    '===== 角色说明书 =====',
    roleText.trim(),
    '',
    '===== 任务卡 =====',
    taskText.trim(),
  ].join('\n');
}

// 记录项目文件的大小与修改时间，用于派发前后对比。
export async function snapshot(root, dir = root, out = new Map()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (SKIPPED.has(entry.name) || SKIPPED.has(rel)) continue;
    if (entry.isDirectory()) {
      await snapshot(root, full, out);
    } else if (entry.isFile()) {
      const info = await stat(full);
      out.set(rel.split(sep).join('/'), `${info.size}:${info.mtimeMs}`);
    }
  }
  return out;
}

// 返回派发期间新增、修改或删除的文件（相对路径，已排序）。
export function diffSnapshots(before, after) {
  const changed = [];
  for (const [path, sig] of after) {
    if (before.get(path) !== sig) changed.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(path);
  }
  return changed.sort();
}

async function readRequired(file, message) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    throw new Error(message);
  }
}

function formatLog({ taskId, role, agentId, model, effort, method, startedAt, endedAt, result, changed, prompt }) {
  const list = changed.length ? changed.map((f) => `  - ${f}`).join('\n') : '  - 无';
  const outcome = result.ok ? '成功' : `失败：${result.error}`;
  return [
    `# 运行记录 · ${taskId} · ${role}`,
    '',
    `- 任务：${taskId}`,
    `- 角色：${role}`,
    `- agent：${agentId}（认证方式：${method}）`,
    `- 模型：${model ?? '未指定，使用 agent 默认模型'}`,
    `- 思考强度：${effort ?? '未指定，使用 agent 默认'}`,
    `- 开始：${startedAt.toISOString()}`,
    `- 结束：${endedAt.toISOString()}`,
    `- 退出码：${result.exitCode ?? '无'}`,
    `- 超时：${result.timedOut ? '是' : '否'}`,
    `- 结果：${outcome}`,
    '- 改动文件（派发前后对比，供 PM 判断是否越界）：',
    list,
    '',
    '## 提示词',
    '',
    '````text',
    prompt,
    '````',
    '',
    '## agent 回复',
    '',
    result.text || '（无）',
    '',
    '## 错误输出（仅供排错，不进入交付物）',
    '',
    '````text',
    result.stderr || '（无）',
    '````',
    '',
  ].join('\n');
}

export async function dispatchTask({
  root,
  taskId,
  role,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  credentialsFile,
  emit = () => {},
}) {
  assertTaskId(taskId);
  assertRole(role);

  const taskText = await readRequired(
    join(root, 'team', 'tasks', `${taskId}.md`),
    `任务卡 team/tasks/${taskId}.md 不存在，请先由 PM 创建`,
  );
  const roleText = await readRequired(
    join(root, 'team', 'roles', `${role}.md`),
    `角色说明书 team/roles/${role}.md 不存在，请先运行 agentteam init`,
  );

  const assignments = await resolveAssignments(root);
  const { agent: agentId, model, effort } = assignments[role];
  const agent = getAgent(agentId);
  const adapter = getAdapter(agentId);

  const credentials = await loadCredentials(credentialsFile);
  const credential = effectiveCredential(credentials.agents[agentId]);
  checkCredential(agent, credential);

  const allowedCommands = await loadAllowedCommands(root);
  const prompt = buildPrompt({ role, taskId, taskText, roleText });
  emit('dispatch.start', { task: taskId, role, agent: agentId, model, effort, method: credential.method });

  const before = await snapshot(root);
  const startedAt = new Date();
  const result = await adapter.run({ prompt, cwd: root, model, effort, credential, timeoutMs, allowedCommands });
  const endedAt = new Date();
  const changed = diffSnapshots(before, await snapshot(root));

  const stamp = endedAt.toISOString().replace(/[:.]/g, '-');
  const logPath = join(root, 'team', 'runs', `${taskId}-${role}-${stamp}.md`);
  await mkdir(join(root, 'team', 'runs'), { recursive: true });
  await writeFile(
    logPath,
    formatLog({ taskId, role, agentId, model, effort, method: credential.method, startedAt, endedAt, result, changed, prompt }),
    'utf8',
  );

  const log = relative(root, logPath).split(sep).join('/');
  emit('dispatch.done', { task: taskId, role, agent: agentId, ok: result.ok, changed, log });
  return { ...result, changed, log };
}
