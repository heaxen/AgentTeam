import { resolve } from 'node:path';
import { initProject } from './init.js';
import { createEmitter } from './events.js';
import { listAgents, getAgent } from './agents.js';
import { loadCredentials, isAuthenticated } from './credentials.js';
import { assignRole, assignAll, setRoleModel, setRoleEffort } from './assign.js';
import { roleRows, formatRoles } from './status.js';
import { runAuth } from './auth.js';
import { hasAdapter } from './adapters/index.js';
import { dispatchTask } from './dispatch.js';
import { currentStage } from './workflow.js';
import { runChat } from './chat.js';
import { createPrompt } from './prompt.js';
import { assignRoleWithChain, assignAllWithChain } from './configure.js';

// 日常只用 agentteam（对话）。下面的子命令给脚本和高级用户用，不出现在帮助里。
const USAGE = `AgentTeam：用对话让一支 AI 团队交付你的需求。

用法：
  agentteam            进入对话（日常只用这个；对话里输入 /help 查看全部命令）
  agentteam init       在项目目录里初始化（第一次使用前运行一次）
  agentteam --help     显示本帮助

第一次使用：
  1. cd 你的项目，然后运行 agentteam init
  2. 在 stacks/ 下新建技术栈档案（复制 stacks/_template.md 并填写）
  3. 运行 agentteam，输入 /auth claude 登录你要用的 agent
  4. 直接说你的需求`;

// 值参数：--model、--effort，支持 "--model X" 与 "--model=X" 两种写法。
const VALUE_FLAGS = ['model', 'effort'];

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
  const values = {};
  const consumed = new Set();
  argv.forEach((a, i) => {
    for (const name of VALUE_FLAGS) {
      if (a === `--${name}`) {
        values[name] = argv[i + 1];
        consumed.add(i + 1);
      } else if (a.startsWith(`--${name}=`)) {
        values[name] = a.slice(name.length + 3);
      }
    }
  });
  const args = argv.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
  return { command: args[0], rest: args.slice(1), json: flags.has('--json'), flags, ...values };
}

export async function main(argv) {
  const { command, rest, json, flags, model, effort } = parseArgs(argv);
  const emit = createEmitter({ json });
  const log = (msg) => {
    if (!json) console.log(msg);
  };

  if (command === 'help' || command === '-h' || command === '--help' || flags.has('--help')) {
    console.log(USAGE);
    return 0;
  }

  if (!command) {
    // 在终端里直接运行 agentteam 进入对话；管道等非交互环境只显示帮助
    if (process.stdin.isTTY) return runChat({ root: process.cwd() });
    console.log(USAGE);
    return 0;
  }

  if (command === 'chat') {
    return runChat({ root: process.cwd() });
  }

  if (command === 'init') {
    const root = resolve(rest[0] ?? '.');
    const { created, skipped } = await initProject(root, emit);
    log(`已初始化：${root}`);
    log(`新建 ${created.length} 个文件，跳过 ${skipped.length} 个已存在的文件。`);
    return 0;
  }

  // 以下为脚本与高级用法（不在帮助中列出）。
  if (command === 'team') {
    const root = process.cwd();
    const { text: stage, req, arch } = await currentStage(root);
    const rows = await roleRows(root);
    log(`当前阶段：${stage}${req ? `（需求 ${req}）` : ''}${arch ? `（架构 ${arch}）` : ''}`);
    log('');
    for (const line of formatRoles(rows)) log(line);
    emit('team.show', { stage, roles: rows });
    return 0;
  }

  if (command === 'agents') {
    const agents = listAgents();
    const credentials = await loadCredentials();
    const rows = agents.map((a) => ({
      id: a.id,
      name: a.name,
      authenticated: isAuthenticated(a, credentials.agents[a.id]),
    }));
    emit('agents.list', { agents: rows });
    for (const r of rows) {
      const runnable = hasAdapter(r.id) ? '可执行角色' : '未接入执行适配器';
      log(`${r.id.padEnd(10)} ${r.name}（${r.authenticated ? '已认证' : '未认证'}；${runnable}）`);
    }
    return 0;
  }

  if (command === 'auth') {
    const [id] = rest;
    if (!id) {
      console.error('用法：agentteam auth <agent>，或在对话里输入 /auth <agent>');
      return 1;
    }
    if (flags.has('--from-env') || flags.has('--confirm')) {
      return runAuth({ id, flags, emit, log });
    }
    const prompt = createPrompt();
    try {
      return await runAuth({ id, flags, emit, log, ask: (q) => prompt.line(q), askKey: (q) => prompt.secret(q) });
    } finally {
      prompt.close();
    }
  }

  if (command === 'assign') {
    const root = process.cwd();
    const interactive = Boolean(process.stdin.isTTY);
    const usage = '用法：agentteam assign <角色> <agent> [--model M] [--effort E]；只改模型或强度：agentteam assign <角色> --model M 或 --effort E；全部角色：agentteam assign --all <agent>';
    const preset = {};
    if (model !== undefined) preset.model = model;
    if (effort !== undefined) preset.effort = effort;

    if (flags.has('--all')) {
      const [agentId] = rest;
      if (!agentId) {
        console.error('用法：agentteam assign --all <agent> [--model M] [--effort E]');
        return 1;
      }
      if (interactive) {
        const prompt = createPrompt();
        try {
          const result = await assignAllWithChain({ root, prompt, log, agentId, preset });
          log(result.saved ? `全部角色已指定为 ${agentId}` : result.reason);
          return result.saved ? 0 : 1;
        } finally {
          prompt.close();
        }
      }
      try {
        await assignAll(root, agentId, model ?? null, effort ?? null);
      } catch (err) {
        console.error(err.message);
        return 1;
      }
      log(`全部角色已指定为 ${agentId}。`);
      if (!hasAdapter(agentId)) log(`注意：${agentId} 尚未接入执行适配器，派发任务时会被拒绝。`);
      return 0;
    }

    if (rest.length === 0) {
      const rows = await roleRows(root);
      emit('assign.show', { roles: rows });
      for (const line of formatRoles(rows)) log(line);
      return 0;
    }

    const [role, agentId] = rest;
    if (!agentId) {
      // 只改模型或强度，agent 不变
      if (model === undefined && effort === undefined) {
        console.error(usage);
        return 1;
      }
      try {
        if (model !== undefined) await setRoleModel(root, role, model);
        if (effort !== undefined) await setRoleEffort(root, role, effort);
      } catch (err) {
        console.error(err.message);
        return 1;
      }
      const changed = [model !== undefined && `模型 ${model}`, effort !== undefined && `思考 ${effort}`].filter(Boolean);
      log(`${role} 已更新：${changed.join('，')}`);
      return 0;
    }

    if (interactive) {
      const prompt = createPrompt();
      try {
        const result = await assignRoleWithChain({ root, prompt, log, role, agentId, preset });
        log(result.saved ? `${role} 已指定为 ${agentId}` : result.reason);
        return result.saved ? 0 : 1;
      } finally {
        prompt.close();
      }
    }

    try {
      await assignRole(root, role, agentId, model ?? null, effort ?? null);
    } catch (err) {
      console.error(err.message);
      return 1;
    }
    log(`${role} 已指定为 ${agentId}。`);
    if (!hasAdapter(agentId)) log(`注意：${agentId} 尚未接入执行适配器，派发该角色时会被拒绝。`);
    const credentials = await loadCredentials();
    if (!isAuthenticated(getAgent(agentId), credentials.agents[agentId])) {
      log(`${agentId} 尚未认证：请运行 agentteam auth ${agentId}`);
    }
    return 0;
  }

  if (command === 'dispatch') {
    const [taskId, role] = rest;
    if (!taskId || !role) {
      console.error('用法：agentteam dispatch <任务号> <角色>，例如 agentteam dispatch T-001 backend-dev');
      return 1;
    }
    let result;
    try {
      result = await dispatchTask({ root: process.cwd(), taskId, role, emit });
    } catch (err) {
      console.error(err.message);
      return 1;
    }
    if (result.ok) {
      log(`${role} 已完成 ${taskId}。运行记录：${result.log}`);
      if (result.changed.length) log(`改动文件：\n${result.changed.map((f) => `  ${f}`).join('\n')}`);
      log(`回复：\n${result.text}`);
      return 0;
    }
    console.error(`${role} 执行 ${taskId} 失败：${result.error}。运行记录：${result.log}`);
    return 1;
  }

  console.error(`未知命令：${command}\n`);
  console.error(USAGE);
  return 1;
}
