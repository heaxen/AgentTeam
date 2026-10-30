import { readFile, writeFile, mkdir, readdir, appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatchTask } from './dispatch.js';

// 用户对话的流程引擎（第一版）。设计见 cli/docs/workflow.md。
// 阶段由本文件决定，不交给 AI 决定，所以每一步都可预期、可重试。
// 每一步都通过 dispatch 交给角色执行，角色的产物以文件为准，对话只是入口。

export const STATE_FILE = join('team', 'state.json');
export const LOG_FILE = join('team', 'conversation.md');

// 执行顺序（第一版固定）。原型与 UI 暂不纳入自动流程，见设计文档。
const BUILD_ORDER = ['backend-dev', 'frontend-dev', 'qa'];
const RETRY_WORDS = ['重试', '继续'];
const CANCEL_WORDS = ['取消'];
const NEW_WORDS = ['新需求', 'new'];
// 进行中的需求：只能继续或取消，其他输入都不会当作新需求。
const ACTIVE_STAGES = ['arch_review', 'failed'];

export const ROLE_NAMES = {
  pm: '项目经理',
  'req-analyst': '需求分析',
  prototype: '原型设计',
  architect: '架构师',
  'ui-dev': 'UI 开发',
  'frontend-dev': '前端开发',
  'backend-dev': '后端开发',
  qa: '测试',
};

export const STAGE_TEXT = {
  idle: '等待需求',
  arch_review: '等待选择方案',
  delivered: '已交付，输入"新需求"开始下一个',
  closed: '已取消，输入"新需求"开始下一个',
  failed: '步骤失败，回复"重试"',
};

const defaultDeps = { dispatch: dispatchTask };

// awaitingNew：取消或交付后输入过"新需求"，下一条输入即为新需求。
function emptyState() {
  return {
    stage: 'idle',
    awaitingNew: false,
    request: null,
    req: null,
    arch: null,
    choice: null,
    pending: null,
    buildDone: [],
  };
}

export async function loadState(root) {
  try {
    return { ...emptyState(), ...JSON.parse(await readFile(join(root, STATE_FILE), 'utf8')) };
  } catch {
    return emptyState();
  }
}

async function saveState(root, state) {
  await mkdir(join(root, 'team'), { recursive: true });
  await writeFile(join(root, STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// 对话记录：用户说的和团队回复的，全部落盘（公约第 13.1 节）。
async function record(root, speaker, text) {
  await mkdir(join(root, 'team'), { recursive: true });
  await appendFile(join(root, LOG_FILE), `\n**${speaker}**（${new Date().toISOString()}）\n\n${text}\n`, 'utf8');
}

async function nextId(root, dir, prefix) {
  let names = [];
  try {
    names = await readdir(join(root, dir));
  } catch {
    // 目录不存在：从 001 开始
  }
  const re = new RegExp(`^${prefix}-(\\d{3})`);
  const nums = names.map((n) => re.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 把角色的工作写成任务卡（第一版由 CLI 生成，之后可交给 PM 角色生成）。
async function writeCard(root, spec) {
  const taskId = await nextId(root, join('team', 'tasks'), 'T');
  const lines = [
    `# ${taskId} ${spec.title}`,
    `目标：${spec.goal}`,
    `范围：${spec.scope}`,
    `不做：${spec.notDo}`,
    `验收依据：交付清单中的文件存在，且符合角色说明书的 DoD`,
    `适用档案：${spec.stack}`,
    `涉及角色：${spec.role}`,
    '输入：',
    ...spec.inputs.map((i) => `- ${i}`),
    '交付：',
    ...spec.outputs.map((o) => `- ${o}`),
  ];
  await mkdir(join(root, 'team', 'tasks'), { recursive: true });
  await writeFile(join(root, 'team', 'tasks', `${taskId}.md`), lines.join('\n') + '\n', 'utf8');
  return taskId;
}

// 派发一个角色，并检查它是否真的交付了清单中的文件（以文件为准，不以汇报为准）。
async function runRole(root, deps, progress, spec) {
  progress(`进度：${ROLE_NAMES[spec.role]}`);
  const taskId = await writeCard(root, spec);
  // 派发前的检查（未认证、未分配等）会抛出异常；转成失败步骤，让用户修正后回复"重试"，而不是结束对话。
  let result;
  try {
    result = await deps.dispatch({ root, taskId, role: spec.role });
  } catch (err) {
    return { ok: false, error: `${ROLE_NAMES[spec.role]}无法启动：${err.message}`, log: null };
  }
  if (!result.ok) return { ok: false, error: `${ROLE_NAMES[spec.role]}执行失败：${result.error}`, log: result.log };

  const missing = [];
  for (const out of spec.outputs) {
    if (!(await exists(join(root, out)))) missing.push(out);
  }
  if (missing.length) {
    return { ok: false, error: `${ROLE_NAMES[spec.role]}没有生成：${missing.join('、')}`, log: result.log };
  }
  return { ok: true, log: result.log };
}

// 从架构摘要中读取方案字母，例如 "## 方案 A：Go + Vue"。
export function parseOptions(summary) {
  return [...summary.matchAll(/^## 方案 ([A-C])/gm)].map((m) => m[1]);
}

// 方案字母与标题，例如 {letter: 'A', title: 'Go + Vue'}。arch 由调用方传入（状态可能尚未落盘）。
export async function planOptions(root, arch) {
  if (!arch) return [];
  const summary = await readFile(join(root, 'docs', 'architecture', `${arch}-summary.md`), 'utf8');
  return [...summary.matchAll(/^## 方案 ([A-C])[：:]?[ \t]*(.*)$/gm)].map((m) => ({
    letter: m[1],
    title: m[2].trim() || `方案 ${m[1]}`,
  }));
}

async function doRequirement(root, state, deps, progress, feedback) {
  const n = (state.req ?? (await nextId(root, join('docs', 'requirements'), 'REQ'))).slice(4);
  state.req = `REQ-${n}`;
  const out = `docs/requirements/REQ-${n}.md`;
  const inputs = [`用户原话：${state.request}`];
  if (feedback) inputs.push(`用户的修改意见：${feedback}`);
  return runRole(root, deps, progress, {
    role: 'req-analyst',
    title: `整理需求 REQ-${n}`,
    goal: `把用户的需求整理成 ${out}`,
    scope: `只写 ${out}`,
    notDo: '不写技术方案，不替用户做技术选型',
    stack: '不涉及（需求阶段）',
    inputs,
    outputs: [out],
  });
}

async function doArchitecture(root, state, deps, progress, feedback) {
  const n = state.req.slice(4);
  state.arch = `ARCH-${n}`;
  const outs = [`docs/architecture/ARCH-${n}.md`, `docs/architecture/ARCH-${n}-summary.md`];
  const inputs = [`需求：docs/requirements/REQ-${n}.md`];
  if (feedback) inputs.push(`用户的想法（需要据此重新设计）：${feedback}`);
  const result = await runRole(root, deps, progress, {
    role: 'architect',
    title: `架构方案 ARCH-${n}`,
    goal: '基于需求给出一个或多个技术方案，并写成一页摘要供用户选择',
    scope: `只写 ${outs.join('、')}`,
    notDo: '不替用户决定；不修改需求文件',
    stack: '不涉及（方案阶段，选型以用户确认为准）',
    inputs,
    outputs: outs,
  });
  if (!result.ok) return result;

  const summary = await readFile(join(root, outs[1]), 'utf8');
  if (parseOptions(summary).length < 1) {
    return { ok: false, error: `摘要中至少需要一个方案，格式为"## 方案 A：……"（见 ${outs[1]}）`, log: result.log };
  }
  return result;
}

async function doBuild(root, state, deps, progress) {
  // 选定的架构方案就是本项目的技术栈，不再要求单独的 stacks/ 档案。
  const stack = `docs/architecture/${state.arch}-summary.md 中的方案 ${state.choice}`;
  const n = state.req.slice(4);
  const choice = `方案 ${state.choice}`;
  const specs = {
    'backend-dev': { out: `docs/backend/IMPL-${n}.md`, goal: `按${choice}实现后端，并写实现记录` },
    'frontend-dev': { out: `docs/frontend/IMPL-${n}.md`, goal: `按${choice}实现前端，并写实现记录` },
    qa: { out: `tests/reports/TR-${n}.md`, goal: '按需求验收条件测试，并写测试报告' },
  };

  for (const role of BUILD_ORDER) {
    if (state.buildDone.includes(role)) continue;
    const spec = specs[role];
    const result = await runRole(root, deps, progress, {
      role,
      title: `${ROLE_NAMES[role]} · ${state.req}`,
      goal: spec.goal,
      scope: `只写 ${spec.out}，并按${choice}约定的位置修改应用代码`,
      notDo: '不修改需求与架构文件；不修改其他角色的目录',
      stack,
      inputs: [`需求：docs/requirements/${state.req}.md`, `架构摘要：docs/architecture/${state.arch}-summary.md`, `已选方案：${choice}`],
      outputs: [spec.out],
    });
    if (!result.ok) return result;
    state.buildDone.push(role);
  }

  const deliveryOut = `docs/delivery/DELIVERY-${n}.md`;
  return runRole(root, deps, progress, {
    role: 'pm',
    title: `交付报告 DELIVERY-${n}`,
    goal: `按 prompts/pm.md 第七节，写面向用户的交付报告 ${deliveryOut}`,
    scope: `只写 ${deliveryOut}`,
    notDo: '不写内部角色细节与门禁编号到报告正文',
    stack: '不涉及（交付阶段）',
    inputs: [`需求：docs/requirements/${state.req}.md`, `测试报告：tests/reports/TR-${n}.md`],
    outputs: [deliveryOut],
  });
}

async function planText(root, state) {
  const plans = await planOptions(root, state.arch);
  const list = plans.map((p) => `  ${p.letter}. ${p.title}`).join('\n');
  return `方案已就绪（${state.arch}）：\n${list}\n\n输入字母或序号选择，也可以用上下键；直接写讨论意见，架构师会据此重新设计。`;
}

function failureText(result) {
  const log = result.log ? `\n运行记录：${result.log}` : '';
  return `${result.error}${log}\n修正后回复"重试"或"继续"；要取消当前需求，回复"取消"（或按 Esc / Ctrl+C）。`;
}

// 执行某一步，并根据结果决定下一个阶段。需求分析完成后直接进入方案阶段，不再等待确认。
async function runStep(root, state, deps, progress, step, feedback) {
  let result;
  if (step === 'requirement') result = await doRequirement(root, state, deps, progress, feedback);
  else if (step === 'architecture') result = await doArchitecture(root, state, deps, progress, feedback);
  else result = await doBuild(root, state, deps, progress);

  if (!result.ok) {
    state.stage = 'failed';
    state.pending = { step, feedback: feedback ?? null };
    return { text: failureText(result) };
  }

  state.pending = null;
  if (step === 'requirement') return runStep(root, state, deps, progress, 'architecture');
  if (step === 'architecture') {
    state.stage = 'arch_review';
    return { text: await planText(root, state) };
  }
  state.stage = 'delivered';
  const n = state.req.slice(4);
  return { text: `全部完成。交付报告：docs/delivery/DELIVERY-${n}.md\n\n需要新需求，请输入"新需求"或"new"后再写。` };
}

// 路由规则：
// - 进行中的需求（方案阶段、失败待重试）只接受选择、重试、取消，其他文字都是讨论，不当作新需求；
// - 第一次使用直接开始；取消或交付后，必须先输入"新需求"或"new"，下一条输入才是新需求。
async function route(root, state, input, deps, progress) {
  const word = input.toLowerCase();
  if (CANCEL_WORDS.includes(word)) return cancel(state);

  if (state.stage === 'arch_review') return routeArchReview(root, state, input, deps, progress);

  if (state.stage === 'failed') {
    if (RETRY_WORDS.includes(input) && state.pending) {
      const { step, feedback } = state.pending;
      return runStep(root, state, deps, progress, step, feedback);
    }
    return { text: `当前需求「${state.request}」尚未完成。回复"重试"或"继续"接着做；要取消请回复"取消"。` };
  }

  if (NEW_WORDS.includes(word)) {
    state.awaitingNew = true;
    return { text: '请输入新需求内容。' };
  }
  if (state.stage === 'idle' || state.awaitingNew) return startRequirement(root, state, deps, progress, input);
  if (state.stage === 'delivered') return { text: '本需求已交付。输入"新需求"或"new"后，再写新的需求。' };
  return { text: '当前没有进行中的需求。输入"新需求"或"new"后，再写新的需求。' };
}

async function cancel(state) {
  if (!ACTIVE_STAGES.includes(state.stage)) return { text: '当前没有进行中的需求。' };
  Object.assign(state, emptyState(), { stage: 'closed' });
  return { text: '已取消当前需求。输入"新需求"或"new"后，再写新的需求。' };
}

// 输入以 /新需求 开头时去掉这个前缀（兼容旧写法）。
async function startRequirement(root, state, deps, progress, input) {
  const text = input.replace(/^\/新需求\s*/, '').trim();
  if (!text) return { text: '请写上需求内容。' };
  Object.assign(state, emptyState(), { request: text });
  return runStep(root, state, deps, progress, 'requirement');
}

async function routeArchReview(root, state, input, deps, progress) {
  const plans = await planOptions(root, state.arch);
  let picked = null;
  if (/^\d+$/.test(input)) {
    const plan = plans[Number(input) - 1];
    if (!plan) return { text: `没有第 ${input} 个方案。可选：1 到 ${plans.length}。` };
    picked = plan.letter;
  } else {
    const match = /^(?:选择?\s*)?([A-C])(?:\s*方案)?$/i.exec(input);
    if (match) picked = match[1].toUpperCase();
  }
  if (picked) {
    if (!plans.some((p) => p.letter === picked)) {
      return { text: `没有方案 ${picked}。可选：${plans.map((p) => p.letter).join('、')}` };
    }
    state.choice = picked;
    return runStep(root, state, deps, progress, 'build');
  }
  // 其他文字是讨论意见：架构师据此修改方案，需求不重新分析。
  return runStep(root, state, deps, progress, 'architecture', input);
}

// 用户每说一句话，调用一次。返回给界面的文字。
export async function handleMessage({ root, text, deps = defaultDeps, onProgress = () => {} }) {
  const input = text.trim();
  const state = await loadState(root);
  await record(root, '你', input);
  const result = await route(root, state, input, deps, onProgress);
  await record(root, 'PM', result.text);
  await saveState(root, state);
  return { text: result.text, stage: state.stage };
}

export async function currentStage(root) {
  const state = await loadState(root);
  return { stage: state.stage, text: STAGE_TEXT[state.stage] ?? state.stage, req: state.req, arch: state.arch };
}
