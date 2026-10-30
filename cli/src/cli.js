import { resolve } from 'node:path';
import { loadConfig, saveConfig, CONFIG_FILE } from './config.js';
import { getProvider, listModes } from './providers/index.js';
import { initProject } from './init.js';
import { createEmitter } from './events.js';
import { listAgents, getAgent } from './agents.js';
import { loadCredentials, saveAgentCredential, isAuthenticated } from './credentials.js';
import { ROLES, assignRole, assignAll, resolveAssignments, AGENT_IDS } from './assign.js';
import { runLoginCommand, keyFromEnv } from './auth.js';
import { hasAdapter } from './adapters/index.js';
import { dispatchTask } from './dispatch.js';

const USAGE = `用法：
  agentteam init [目录]                 在项目中写入团队公约、角色说明书和目录结构（不覆盖已有文件）
  agentteam config show                 查看当前配置
  agentteam config set <键> <值>        设置 mode（subscription | api）、model、apiKey
  agentteam doctor                      检查当前模式是否可用
  agentteam run "<提示词>"              用当前模式调用一次模型（用于验证连通性）
  agentteam agents                      列出可供选择的 agent 及认证状态
  agentteam auth <agent>                启动该 agent 自己的登录（订阅）；需要 key 的用 --from-env
  agentteam auth <agent> --from-env     从对应环境变量读取 API key 并保存在本机
  agentteam auth <agent> --confirm      你已在该 agent 中手动完成登录后，记录为已认证
  agentteam assign                      查看当前项目每个角色使用的 agent
  agentteam assign <角色> <agent>       给角色指定 agent（在当前项目的 team/assignments.json 中记录）
  agentteam assign --all <agent>        全部角色使用同一个 agent
  agentteam dispatch <任务号> <角色>     把任务卡交给该角色分配的 agent 执行（如 agentteam dispatch T-001 backend-dev）

全局选项：
  --json    以 JSON 行输出事件（供 Web / 移动端 / 小程序等外部界面读取）`;

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const args = argv.filter((a) => !a.startsWith('--'));
  return { command: args[0], rest: args.slice(1), json: flags.has('--json'), flags };
}

export async function main(argv) {
  const { command, rest, json, flags } = parseArgs(argv);
  const emit = createEmitter({ json });
  const log = (msg) => {
    if (!json) console.log(msg);
  };

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'init') {
    const root = resolve(rest[0] ?? '.');
    const { created, skipped } = await initProject(root, emit);
    log(`已初始化：${root}`);
    log(`新建 ${created.length} 个文件，跳过 ${skipped.length} 个已存在的文件。`);
    return 0;
  }

  if (command === 'config') {
    const [sub, key, value] = rest;
    if (sub === 'show') {
      const config = await loadConfig();
      const shown = { ...config, apiKey: config.apiKey ? '已设置' : '未设置' };
      emit('config.show', { config: shown, file: CONFIG_FILE });
      log(JSON.stringify(shown, null, 2));
      return 0;
    }
    if (sub === 'set') {
      if (!['mode', 'model', 'apiKey'].includes(key)) {
        console.error('可设置的键：mode、model、apiKey');
        return 1;
      }
      if (key === 'mode' && !listModes().includes(value)) {
        console.error(`mode 只能是：${listModes().join(' / ')}`);
        return 1;
      }
      await saveConfig({ [key]: value });
      emit('config.set', { key });
      log(`已保存 ${key}（配置文件：${CONFIG_FILE}）`);
      return 0;
    }
    console.error('用法：agentteam config show | config set <键> <值>');
    return 1;
  }

  if (command === 'doctor') {
    const config = await loadConfig();
    const provider = getProvider(config.mode);
    const ok = await provider.available(config);
    emit('doctor.result', { mode: config.mode, ok });
    log(ok ? `模式 ${config.mode} 可用` : `模式 ${config.mode} 不可用：请检查 ${config.mode === 'api' ? 'apiKey' : '本机是否已安装并登录 Claude Code'}`);
    return ok ? 0 : 1;
  }

  if (command === 'run') {
    const prompt = rest.join(' ').trim();
    if (!prompt) {
      console.error('请提供提示词，例如：agentteam run "你好"');
      return 1;
    }
    const config = await loadConfig();
    const provider = getProvider(config.mode);
    emit('run.start', { mode: config.mode, model: config.model });
    const { text } = await provider.run({
      prompt,
      model: config.model,
      apiKey: config.apiKey,
      cwd: process.cwd(),
    });
    emit('run.done', { text });
    log(text);
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
      console.error('用法：agentteam auth <agent> [--from-env | --confirm]');
      return 1;
    }
    let agent;
    try {
      agent = getAgent(id);
    } catch (err) {
      console.error(err.message);
      return 1;
    }

    if (flags.has('--from-env')) {
      const found = keyFromEnv(agent);
      if (!found) {
        console.error(`环境变量中没有找到 ${agent.apiKeyEnv?.join(' / ') || '（该 agent 不使用 API key）'}`);
        return 1;
      }
      await saveAgentCredential(agent.id, { method: 'api', apiKey: found.value, savedAt: new Date().toISOString() });
      emit('auth.saved', { agent: agent.id, from: found.name });
      log(`已从 ${found.name} 读取并保存 ${agent.name} 的 key（不会显示内容）`);
      return 0;
    }

    if (flags.has('--confirm')) {
      await saveAgentCredential(agent.id, { method: 'subscription', loggedInAt: new Date().toISOString() });
      emit('auth.confirmed', { agent: agent.id });
      log(`已记录 ${agent.name} 为已认证`);
      return 0;
    }

    if (agent.loginCommand) {
      log(`正在启动 ${agent.name} 的登录：${agent.loginCommand}`);
      const code = await runLoginCommand(agent);
      if (code !== 0) {
        console.error(`登录未完成（退出码 ${code}），未记录认证状态。`);
        return 1;
      }
      await saveAgentCredential(agent.id, { method: 'subscription', loggedInAt: new Date().toISOString() });
      emit('auth.saved', { agent: agent.id, method: 'subscription' });
      log(`${agent.name} 已登录，之后调用不再要求认证。`);
      return 0;
    }

    if (agent.kind === 'api') {
      console.error(`${agent.name} 只支持 API key，请先在环境变量中设置 ${agent.apiKeyEnv.join(' / ')}，再执行 agentteam auth ${agent.id} --from-env`);
      return 1;
    }

    log(`${agent.name} 没有可直接启动的登录命令，请手动完成登录：`);
    log(`  ${agent.login}`);
    log(`完成后执行：agentteam auth ${agent.id} --confirm`);
    return 0;
  }

  if (command === 'assign') {
    const root = process.cwd();
    if (flags.has('--all')) {
      const [agentId] = rest;
      if (!agentId) {
        console.error('用法：agentteam assign --all <agent>');
        return 1;
      }
      try {
        await assignAll(root, agentId);
      } catch (err) {
        console.error(err.message);
        return 1;
      }
      emit('assign.all', { agent: agentId });
      log(`全部角色已指定为 ${agentId}`);
      if (!hasAdapter(agentId)) log(`注意：${agentId} 尚未接入执行适配器，派发任务时会被拒绝。`);
      return 0;
    }

    if (rest.length === 0) {
      const resolved = await resolveAssignments(root);
      emit('assign.show', { assignments: resolved });
      for (const role of ROLES) {
        const suffix = hasAdapter(resolved[role]) ? '' : '（未接入执行适配器）';
        log(`${role.padEnd(13)} ${resolved[role]}${suffix}`);
      }
      return 0;
    }

    const [role, agentId] = rest;
    if (!role || !agentId) {
      console.error(`用法：agentteam assign <角色> <agent>（角色：${ROLES.join('、')}；agent：${AGENT_IDS.join('、')}）`);
      return 1;
    }
    try {
      await assignRole(root, role, agentId);
    } catch (err) {
      console.error(err.message);
      return 1;
    }
    emit('assign.set', { role, agent: agentId });
    log(`${role} 已指定为 ${agentId}`);
    if (!hasAdapter(agentId)) log(`注意：${agentId} 尚未接入执行适配器，派发该角色时会被拒绝。`);
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
