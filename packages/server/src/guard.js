// 本机服务也要防网页偷调：浏览器里任何网页都能向 127.0.0.1 发请求，
// 而这个服务能指挥带编辑权限的 agent。所以 Host 必须是本机地址，带 Origin 时也必须是本机页面。
// allowedHosts 为 null 表示不校验（只用于没有监听端口的单元测试）。返回拒绝原因，通过返回 null。
export function checkRequest(req, allowedHosts) {
  if (!allowedHosts) return null;
  const host = req.headers.host;
  if (!host || !allowedHosts.has(host)) return '不允许的 Host';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const local = origin.startsWith('http://') && allowedHosts.has(origin.slice('http://'.length));
    if (!local) return '不允许的 Origin';
  }
  return null;
}
