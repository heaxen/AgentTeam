import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { handleMessage, currentStage, planOptions } from './workflow.js';
import { ROLES, resolveAssignments } from './assign.js';
import { listAgents } from './agents.js';
import { loadCredentials, isAuthenticated } from './credentials.js';
import { hasAdapter } from './adapters/index.js';
import { runAuth } from './auth.js';
import { roleRows, formatRoles } from './status.js';
import { createPrompt } from './prompt.js';
import {
  assignRoleWithChain,
  assignAllWithChain,
  changeModelWithChain,
  changeEffortWithChain,
} from './configure.js';

// 对话界面：唯一的日常入口。流程见 workflow.js，设计见 cli/docs/workflow.md。
export const CHAT_HELP = `直接输入需求，团队会开始分析并列出方案：
  <需求描述>               开始一个需求（第一次使用时；之后见下面的"新需求"）
  上下键 + 回车 / 序号     选择方案（方案阶段）；也可以输入字母，如 A
  其他文字                 对方案提讨论意见，不会当作新需求
  重试 / 继续              上一步失败后，修正原因再重试
  取消                     取消当前需求（也可以按 Esc 或 Ctrl+C，输入框有字时先清空）
  新需求 / new             取消或交付后，再输入这两个词，下一条输入即为新需求

设置（以 / 开头）：
  /team                    查看每个角色的 agent、模型与思考强度
  /agents                  查看可用的 agent 及是否已认证
  /auth <agent>            登录 agent（订阅），或粘贴 API key（输入不显示）
  /assign <角色> <agent>   给角色换 agent；未登录会先登录，然后依次选择模型、思考强度
  /assign all <agent>      全部角色换成同一个 agent，流程同上
  /model <角色>            为角色重新选择模型与思考强度
  /effort <角色>           只为角色重新选择思考强度
  /help                    显示本说明
  /退出  或  exit          结束对话`;

const ASSIGN_USAGE = '用法：/assign <角色> <agent>，或 /assign all <agent>。角色见 /team。';

async function agentLines() {
  const credentials = await loadCredentials();
  return listAgents().map((a) => {
    const auth = isAuthenticated(a, credentials.agents[a.id]) ? '已认证' : '未认证';
    const run = hasAdapter(a.id) ? '可执行' : '未接入执行适配器';
    return `${a.id.padEnd(10)} ${a.name}（${auth}；${run}）`;
  });
}

function describe(result) {
  return result.saved ? '配置已保存。' : result.reason;
}

// 以 / 开头的设置命令。需要选择或输入时使用 prompt，返回要显示的文字。
export async function runChatCommand(root, text, { prompt, log = console.log, file, authFn } = {}) {
  const [cmd, ...args] = text.split(/\s+/);

  if (cmd === '/help') return `${CHAT_HELP}\n\n角色：${ROLES.join('、')}`;
  if (cmd === '/agents') return (await agentLines()).join('\n');
  if (cmd === '/team') return formatRoles(await roleRows(root)).join('\n');

  if (cmd === '/auth') {
    const [id] = args;
    if (!id) return '用法：/auth <agent>，例如 /auth claude';
    await runAuth({ id, ask: (q) => prompt.line(q), askKey: (q) => prompt.secret(q), log, file });
    return '';
  }

  if (cmd === '/assign') {
    if (args[0] === 'all') {
      const [, agentId] = args;
      if (!agentId) return ASSIGN_USAGE;
      try {
        return describe(await assignAllWithChain({ root, prompt, log, agentId, file, authFn }));
      } catch (err) {
        return err.message;
      }
    }
    const [role, agentId] = args;
    if (!role || !agentId) return ASSIGN_USAGE;
    try {
      return describe(await assignRoleWithChain({ root, prompt, log, role, agentId, file, authFn }));
    } catch (err) {
      return err.message;
    }
  }

  if (cmd === '/model') {
    const [role] = args;
    if (!role) return '用法：/model <角色>，例如 /model qa';
    try {
      return describe(await changeModelWithChain({ root, prompt, log, role }));
    } catch (err) {
      return err.message;
    }
  }

  if (cmd === '/effort') {
    const [role] = args;
    if (!role) return '用法：/effort <角色>，例如 /effort qa';
    try {
      return describe(await changeEffortWithChain({ root, prompt, log, role }));
    } catch (err) {
      return err.message;
    }
  }

  return `未知命令：${cmd}。输入 /help 查看可用命令。`;
}

// 底部状态栏：左边是项目目录、分支与当前阶段，右边是各 agent 分配的角色数。
async function statusBar(root) {
  const { text: stage } = await currentStage(root);
  const branch = await gitBranch(root);
  const assignments = await resolveAssignments(root);
  const counts = {};
  for (const { agent } of Object.values(assignments)) counts[agent] = (counts[agent] ?? 0) + 1;
  return {
    left: `${root}${branch ? `  ${branch}` : ''}  ·  阶段：${stage}`,
    right: `${Object.entries(counts).map(([agent, n]) => `${agent} ×${n}`).join('  ')}  ·  /team 查看详情`,
  };
}

// 读取 .git/HEAD 得到分支名；不是 git 仓库时返回空。
async function gitBranch(root) {
  try {
    const head = await readFile(join(root, '.git', 'HEAD'), 'utf8');
    const match = /ref: refs\/heads\/(.+)/.exec(head);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

export async function runChat({ root }) {
  const prompt = createPrompt();
  const print = (text) => prompt.print(text);
  print('AgentTeam 对话已开始。输入 /help 查看用法。');

  const credentials = await loadCredentials();
  const anyAuthed = listAgents().some((a) => isAuthenticated(a, credentials.agents[a.id]));
  if (!anyAuthed) {
    print('还没有可用的 agent。先输入 /auth claude（订阅登录）或 /auth deepseek（粘贴 API key）。');
  }
  print('');

  try {
    for (;;) {
      prompt.setStatus(await statusBar(root));
      const line = await prompt.line('', { cancelable: true });
      if (line === null) break; // 输入结束（如管道关闭）
      const text = line.trim();
      if (!text) continue;
      if (text === 'exit' || text === '/退出') break;

      // 设置命令的名字都是英文（/team、/assign……）；以 / 开头的中文句子仍当作需求或意见
      if (/^\/[A-Za-z]/.test(text)) {
        const reply = await runChatCommand(root, text, { prompt, log: print });
        print(reply ? `\n${reply}\n` : '');
        continue;
      }

      let next = text;
      for (;;) {
        prompt.setBusy('团队执行中');
        let result;
        try {
          result = await handleMessage({ root, text: next, onProgress: (msg) => print(`  ${msg}`) });
        } finally {
          prompt.setBusy(null);
        }
        // 方案阶段且终端支持选择列表：用上下键或序号选择；按 Esc 跳过，改为直接输入。
        if (result.stage !== 'arch_review' || !prompt.select) {
          print(`\nPM> ${result.text}\n`);
          break;
        }
        const { arch } = await currentStage(root);
        const plans = await planOptions(root, arch);
        const index = await prompt.select({
          title: '请选择方案（↑↓ 选择，回车确认；Esc 跳过）',
          labels: plans.map((p) => `${p.letter}. ${p.title}`),
        });
        if (index === null) {
          print(`\nPM> ${result.text}\n`);
          break;
        }
        next = plans[index].letter;
      }
    }
  } finally {
    prompt.close();
  }
  return 0;
}
