import { subscriptionProvider } from './subscription.js';
import { apiProvider } from './api.js';

// 模型调用的统一入口。上层（任务执行、角色调度）只依赖 getProvider().run()，
// 不关心是订阅还是 API。以后接入其他模型，只需在这里加一个实现。
const providers = {
  subscription: subscriptionProvider,
  api: apiProvider,
};

export function getProvider(mode) {
  const provider = providers[mode];
  if (!provider) {
    throw new Error(`未知模式 "${mode}"，可选：${Object.keys(providers).join(' / ')}`);
  }
  return provider;
}

export function listModes() {
  return Object.keys(providers);
}
