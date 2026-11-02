import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('未找到');
}

export function createStaticHandler(webDir) {
  const base = resolve(webDir);
  return async function serveStatic(req, res, url) {
    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      return notFound(res);
    }
    let file = resolve(join(base, relative));
    // 解码和规范化之后仍必须在 web 目录之内。
    if (file !== base && !file.startsWith(base + sep)) return notFound(res);

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) {
      // 单页应用：不带扩展名的未知路径交给前端路由；带扩展名的缺失资源是真的 404。
      if (extname(relative)) return notFound(res);
      file = join(base, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info?.isFile()) return notFound(res);
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  };
}
