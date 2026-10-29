import { resolve } from 'node:path';
import { loadConfig, saveConfig, CONFIG_FILE } from './config.js';
import { getProvider, listModes } from './providers/index.js';
import { initProject } from './init.js';
import { createEmitter } from './events.js';

const USAGE = `用法：
  agentteam init [目录]                 在项目中写入团队公约、角色说明书和目录结构（不覆盖已有文件）
  agentteam config show                 查看当前配置
  agentteam config set <键> <值>        设置 mode（subscription | api）、model、apiKey
  agentteam doctor                      检查当前模式是否可用
  agentteam run "<提示词>"              用当前模式调用一次模型（用于验证连通性）

全局选项：
  --json    以 JSON 行输出事件（供 Web / 移动端 / 小程序等外部界面读取）`;

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const args = argv.filter((a) => !a.startsWith('--'));
  return { command: args[0], rest: args.slice(1), json: flags.has('--json') };
}

export async function main(argv) {
  const { command, rest, json } = parseArgs(argv);
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

  console.error(`未知命令：${command}\n`);
  console.error(USAGE);
  return 1;
}
