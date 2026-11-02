// SSE 事件流：先补发 seq 大于 after 的历史事件，再推送实时事件。
// 补发和订阅都在同一个同步片段里完成，期间不会有事件插进来，所以既没有空洞也不会重复；
// 仍用 last 去重，是为了让这个保证不依赖调用方的实现细节。
export function serveEvents(req, res, log, { heartbeatMs = 15000 } = {}) {
  const url = new URL(req.url, 'http://local');
  const raw = url.searchParams.get('after') ?? req.headers['last-event-id'] ?? '0';
  if (!/^\d+$/.test(raw)) return false;
  const after = Number(raw);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');

  let last = after;
  const send = (event) => {
    if (event.seq <= last) return;
    last = event.seq;
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = log.subscribe(send);
  for (const event of log.after(after)) send(event);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
  heartbeat.unref?.();
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return true;
}
