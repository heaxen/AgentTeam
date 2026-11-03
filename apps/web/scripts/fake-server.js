import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../../packages/server/src/serve.js';
import { createSession } from '../../../packages/core/src/session.js';

const PORT = 4399;
const WEB_DIR = fileURLToPath(new URL('../dist', import.meta.url));
// startServer 在 webDir 不存在时会静默跳过静态托管（页面打不开但接口正常），
// 所以这里先明确失败，把"忘了构建"变成一条清楚的错误。
if (!existsSync(join(WEB_DIR, 'index.html'))) {
  console.error(`找不到 ${WEB_DIR}/index.html，请先运行 npm run build -w apps/web`);
  process.exit(1);
}

// 假的派发：不调用任何真实 agent。与 packages/core/test/session.test.js 的 fakeDispatch 同构：
// 按任务卡"交付："段写文件；另外写一个应用代码文件，满足工作流"实现角色必须改动应用代码"的判定。
// 每个角色停顿 ROLE_DELAY_MS：真实角色要跑几分钟，这里留一点时间让界面能显示出进度，
// 也让"边跑边刷新的渲染逻辑"真的被执行到（否则所有事件会在同一帧里到达）。
// 注意：e2e 不断言"运行中"这种瞬时状态，只断言会持久存在的内容。
const ROLE_DELAY_MS = 300;

async function fakeDispatch({ root, taskId, role, onOutput }) {
  onOutput?.(`${role} 工作中\n`);
  await new Promise((resolve) => setTimeout(resolve, ROLE_DELAY_MS));
  const card = await readFile(join(root, 'team', 'tasks', `${taskId}.md`), 'utf8');
  const lines = card.split('\n');
  const outputs = lines
    .slice(lines.indexOf('交付：') + 1)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));

  for (const output of outputs) {
    const full = join(root, output);
    await mkdir(join(full, '..'), { recursive: true });
    const body = output.endsWith('-summary.md')
      ? '## 方案 A：Node + React\n\n## 方案 B：Go + Vue\n'
      : `# ${output}\n`;
    await writeFile(full, body, 'utf8');
  }

  const changed = [...outputs];
  if (role === 'backend-dev' || role === 'frontend-dev') {
    const code = join(root, 'src', `${role}.js`);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(code, `// ${role}\n`, 'utf8');
    changed.push(`src/${role}.js`);
  }

  return { ok: true, text: '', changed, log: null };
}

const root = await mkdtemp(join(tmpdir(), 'agentteam-e2e-'));
const session = await createSession({ root, dispatch: fakeDispatch });
const server = await startServer({
  root,
  port: PORT,
  credentialsFile: join(root, 'credentials.json'),
  webDir: WEB_DIR,
  // 必须显式传入：不传的话 startServer 会自己用真实的 dispatchTask 建一个会话，
  // 于是 e2e 会真的去调 claude/codex，违反"测试不调用真实 agent"的约束。
  session,
});

console.log(`fake-server 已启动：${server.url}（项目目录 ${root}）`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
