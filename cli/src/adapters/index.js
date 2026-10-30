import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { geminiAdapter } from './gemini.js';
import { deepseekAdapter } from './deepseek.js';

// 执行适配器登记处。只有在这里登记、且 canEditFiles 为 true 的 agent，才能执行角色任务。
// 注册表（agents.js）里有但这里没有的 agent，可以分配，但派发时会被拒绝并说明原因。
const ADAPTERS = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  deepseek: deepseekAdapter,
};

export function hasAdapter(agentId) {
  return Object.hasOwn(ADAPTERS, agentId);
}

export function getAdapter(agentId) {
  if (!hasAdapter(agentId)) {
    throw new Error(`${agentId} 尚未接入执行适配器，暂不能执行角色任务（进度见 cli/docs/adapters.md 第三节）`);
  }
  const adapter = ADAPTERS[agentId];
  if (!adapter.canEditFiles) {
    throw new Error(`${agentId} 只能返回文本、不能读写项目文件，暂不能执行角色任务（待决策，见 cli/docs/adapters.md 第七节）`);
  }
  return adapter;
}
