import { getAgent, supportsEffort } from './agents.js';
import { assignRole, assignAll, checkModel, resolveAssignments } from './assign.js';
import { authIfNeeded } from './auth.js';

// 角色配置的链式流程：认证 → 模型 → 思考强度 → 保存。
// 每一步都是编号列表，用户选择；回车选第一项（默认）。输入结束或取消时返回 undefined，不改动原配置。
// prompt 来自 prompt.js，测试时可以替换成按顺序回答的假输入。

const CUSTOM = '__custom__';
const EFFORT_LABEL = { off: '关闭思考' };

// 编号列表选择。返回所选项的 value；输入结束返回 undefined。
export async function chooseFrom({ prompt, log, title, options }) {
  // 终端中用上下键选择（同时仍可输入编号）；否则按行读取编号。
  if (prompt.select) {
    const index = await prompt.select({ title, labels: options.map((o) => o.label) });
    return index === null ? undefined : options[index].value;
  }
  log(title);
  options.forEach((o, i) => log(`  ${i + 1}. ${o.label}`));
  for (;;) {
    const answer = await prompt.line(`请输入编号（回车选 1）：`);
    if (answer === null) return undefined;
    if (answer === '') return options[0].value;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    log(`请输入 1 到 ${options.length} 之间的编号。`);
  }
}

// 模型：agent 默认、列出的模型、或手动输入。返回模型名（null 表示 agent 默认），取消返回 undefined。
export async function chooseModel({ prompt, log, agentId }) {
  const agent = getAgent(agentId);
  const options = [
    { label: 'agent 默认模型（推荐）', value: null },
    ...(agent.models ?? []).map((m) => ({ label: m, value: m })),
    { label: '其他（手动输入模型名）', value: CUSTOM },
  ];
  const value = await chooseFrom({ prompt, log, title: `选择 ${agent.name} 的模型：`, options });
  if (value !== CUSTOM) return value;

  for (;;) {
    const name = await prompt.line('请输入模型名（如 gpt-5），直接回车取消：');
    if (name === null || name === '') return undefined;
    try {
      return checkModel(name);
    } catch (err) {
      log(err.message);
    }
  }
}

// 思考强度：agent 不支持按次设置时直接返回 null，跳过此步。
export async function chooseEffort({ prompt, log, agentId }) {
  const agent = getAgent(agentId);
  if (!supportsEffort(agent)) return null;
  const options = [
    { label: 'agent 默认（推荐）', value: null },
    ...agent.efforts.map((e) => ({ label: EFFORT_LABEL[e] ?? e, value: e })),
  ];
  return chooseFrom({ prompt, log, title: `选择 ${agent.name} 的思考强度：`, options });
}

// 模型 → 思考强度。preset 中有值（包括 null）的步骤直接跳过。返回 { model, effort }，取消返回 null。
export async function chooseModelAndEffort({ prompt, log, agentId, preset = {} }) {
  const model = preset.model !== undefined ? preset.model : await chooseModel({ prompt, log, agentId });
  if (model === undefined) return null;
  const effort = preset.effort !== undefined ? preset.effort : await chooseEffort({ prompt, log, agentId });
  if (effort === undefined) return null;
  return { model, effort };
}

// 认证 → 模型 → 思考强度 → 保存。认证未完成或取消时不改动原配置。
export async function assignRoleWithChain({ root, prompt, log, role, agentId, preset = {}, file, authFn = authIfNeeded }) {
  const authed = await authFn(agentId, { ask: (q) => prompt.line(q), askKey: (q) => prompt.secret(q), log, file });
  if (!authed) return { saved: false, reason: '未完成认证，配置未改动' };
  const picked = await chooseModelAndEffort({ prompt, log, agentId, preset });
  if (!picked) return { saved: false, reason: '已取消，配置未改动' };
  await assignRole(root, role, agentId, picked.model, picked.effort);
  return { saved: true, picked };
}

// 全部角色使用同一个 agent：认证 → 模型 → 思考强度 → 保存到每个角色。
export async function assignAllWithChain({ root, prompt, log, agentId, preset = {}, file, authFn = authIfNeeded }) {
  const authed = await authFn(agentId, { ask: (q) => prompt.line(q), askKey: (q) => prompt.secret(q), log, file });
  if (!authed) return { saved: false, reason: '未完成认证，配置未改动' };
  const picked = await chooseModelAndEffort({ prompt, log, agentId, preset });
  if (!picked) return { saved: false, reason: '已取消，配置未改动' };
  await assignAll(root, agentId, picked.model, picked.effort);
  return { saved: true, picked };
}

// 只改某个角色的模型与思考强度（agent 不变）。
export async function changeModelWithChain({ root, prompt, log, role, preset = {} }) {
  const current = (await resolveAssignments(root))[role];
  const picked = await chooseModelAndEffort({ prompt, log, agentId: current.agent, preset });
  if (!picked) return { saved: false, reason: '已取消，配置未改动' };
  await assignRole(root, role, current.agent, picked.model, picked.effort);
  return { saved: true, picked };
}

// 只改某个角色的思考强度（agent 与模型不变）。
export async function changeEffortWithChain({ root, prompt, log, role }) {
  const current = (await resolveAssignments(root))[role];
  const effort = await chooseEffort({ prompt, log, agentId: current.agent });
  if (effort === undefined) return { saved: false, reason: '已取消，配置未改动' };
  if (effort === null && !supportsEffort(getAgent(current.agent))) {
    return { saved: false, reason: `${getAgent(current.agent).name} 不支持按次设置思考强度` };
  }
  await assignRole(root, role, current.agent, current.model, effort);
  return { saved: true, picked: { model: current.model, effort } };
}
