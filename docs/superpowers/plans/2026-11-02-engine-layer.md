# 引擎层（core + protocol）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 `cli/` 里的引擎代码迁入 npm workspaces 的 `@agentteam/core`，新增 `@agentteam/protocol`，让引擎能发出带序号的结构化事件（含各 agent 的实时文本输出），并用每项目一个的 Session 取代全局暂停变量。

**Architecture:** 仓库根目录建 npm workspaces。`packages/core` 放适配器、状态机、派发、凭证、事件日志与 Session，不依赖任何 HTTP 或 UI 代码；`packages/protocol` 放事件定义与校验。`cli/` 暂时保留终端交互代码，通过转发文件（`export * from '@agentteam/core/...'`）继续使用被迁走的模块，所以旧测试和旧入口不用改。

**Tech Stack:** Node.js ESM（`>=18`，本机 v26.4.0）、`node:test`、npm workspaces。不引入新依赖。

**Spec:** `docs/superpowers/specs/2026-10-30-web-console-design.md`（本计划实现其第 2、3、4.1、5、6 节中属于引擎层的部分；第 4.2 节接口、server、web、cli 入口由后续计划实现）

## Global Constraints

- 提交由用户授权（`AGENTS.md` R6 与用户记忆规则）：**任何步骤都不得执行 `git commit` / `git push`**。每个任务末尾是"检查点"，只列出改动文件，等用户说提交再提交。
- 协议事件字段只增不减；事件必带 `v`、`seq`、`time`（spec 4.1）。
- 不引入新的第三方依赖；workspace 内部依赖写 `"*"`。
- 不改动用户项目目录下 `team/state.json`、`team/runs/`、`team/conversation.md` 的格式；新增 `team/events.jsonl`（spec 3）。
- 中文文本一律保持可读原样，不做编码转换（`C:\Users\22432\AGENTS.md` Encoding Policy）。
- 新增的适配器参数都是可选的；不传时行为与现在完全相同，现有测试不得因此修改断言。
- 代码风格沿用现有文件：ESM、两空格缩进、单引号、中文注释、注释只写"为什么"。

## 不在本计划内

- server（HTTP + SSE）、web、`packages/cli` 入口：后续计划。
- 取消正在运行的角色并强制终止子进程（需要把 `AbortSignal` 贯穿 `runProcess`）：记入 `docs/backlog.md` 的 B-005，在 server 计划里实现。
- 删除 `cli/` 里的终端交互代码：Web 版跑通之后再做。
- `core/roles/` 目录：团队文件仍由 `sync-templates` 从仓库根目录复制到 `packages/core/templates/`（根目录是唯一来源），本计划不改这一机制，spec 已同步说明。

## File Structure

```
package.json                                  新建：workspaces 根
packages/
├─ protocol/
│  ├─ package.json                            新建
│  ├─ src/index.js                            新建：PROTOCOL_VERSION、EVENT_FIELDS、makeEvent、validateEvent
│  └─ test/protocol.test.js                   新建
└─ core/
   ├─ package.json                            新建
   ├─ scripts/sync-templates.js               从 cli/scripts 迁入并改路径
   ├─ src/
   │  ├─ adapters/*                           从 cli/src/adapters 迁入；process.js、claude.js、codex.js、gemini.js、deepseek.js 加流式
   │  ├─ agents.js allowlist.js assign.js auth.js credentials.js
   │  │  dispatch.js workflow.js              从 cli/src 迁入；dispatch.js、workflow.js 小改
   │  ├─ store/events.js                      新建：事件日志（序号、落盘、订阅、续传）
   │  └─ session.js                           新建：每项目一个运行会话
   └─ test/
      ├─ adapters|auth|deepseek|dispatch|effort|team|workflow.test.js   从 cli/test 迁入
      ├─ event-log.test.js stream.test.js session.test.js               新建
      └─ fixtures/claude-stream.jsonl         新建：真实采集的样本
cli/
├─ package.json                               改：依赖 @agentteam/core，去掉 sync 相关脚本
└─ src/{agents,allowlist,assign,auth,credentials,dispatch,workflow}.js、adapters/*.js   改为转发文件
```

---

### Task 1: 建 workspaces，迁移 core，旧代码经转发文件继续可用

**Files:**
- Create: `package.json`、`packages/core/package.json`、`packages/protocol/package.json`
- Move: 见 Step 3
- Modify: `packages/core/scripts/sync-templates.js`、`cli/package.json`
- Create: `cli/src/*.js` 与 `cli/src/adapters/*.js` 转发文件（Step 4）

**Interfaces:**
- Produces: 包名 `@agentteam/core`（子路径导出 `@agentteam/core/<模块>`，对应 `src/<模块>.js`，如 `@agentteam/core/adapters/claude`）、`@agentteam/protocol`；根目录 `npm test` 跑所有 workspace 的测试。
- Consumes: 无。

- [ ] **Step 1: 记录迁移前的测试基线**

Run（在仓库根目录 `C:\Users\22432\Desktop\AgentTeam`）：
```bash
cd cli && npm test 2>&1 | grep -E "^(#|ℹ) (tests|pass|fail) "; cd ..
```
Expected: `fail 0`。记下 `tests` 和 `pass` 的数字，记作 N。若基线本身有失败，停下来告诉用户，不要在失败的基础上迁移。

- [ ] **Step 2: 建根 package.json 与两个包的 package.json**

`package.json`（仓库根）：
```json
{
  "name": "agentteam-workspace",
  "private": true,
  "workspaces": ["cli", "packages/*"],
  "scripts": {
    "test": "npm run sync -w @agentteam/core && npm test --workspaces --if-present"
  }
}
```

`packages/protocol/package.json`：
```json
{
  "name": "@agentteam/protocol",
  "version": "0.5.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.js" },
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test" }
}
```

`packages/core/package.json`：
```json
{
  "name": "@agentteam/core",
  "version": "0.5.0",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*.js" },
  "engines": { "node": ">=18" },
  "dependencies": { "@agentteam/protocol": "*" },
  "scripts": {
    "sync": "node scripts/sync-templates.js",
    "pretest": "npm run sync",
    "test": "node --test"
  }
}
```

- [ ] **Step 3: 用 git mv 迁移文件（保留历史）**

Run（仓库根目录）：
```bash
mkdir -p packages/core/src packages/core/test packages/core/scripts packages/protocol/src packages/protocol/test
git mv cli/src/adapters packages/core/src/adapters
for f in agents allowlist assign auth credentials dispatch workflow; do git mv cli/src/$f.js packages/core/src/$f.js; done
for t in adapters auth deepseek dispatch effort team workflow; do git mv cli/test/$t.test.js packages/core/test/$t.test.js; done
git mv cli/scripts/sync-templates.js packages/core/scripts/sync-templates.js
```
留在 `cli/` 的：`chat.js cli.js configure.js events.js prompt.js status.js tui.js` 及其测试（`chat configure select tui ui-mode`）。迁移依据是前面核对过的 import 关系：被迁走的模块只依赖彼此和 node 内置模块。

- [ ] **Step 4: 在 cli 里生成转发文件**

Run：
```bash
cd cli/src
for f in agents allowlist assign auth credentials dispatch workflow; do echo "export * from '@agentteam/core/$f';" > $f.js; done
mkdir adapters
for f in claude codex deepseek gemini index process; do echo "export * from '@agentteam/core/adapters/$f';" > adapters/$f.js; done
cd ../..
```
注意：`export *` 不转发默认导出，已核对这些模块都只有具名导出。转发后 `cli/src/workflow.js` 与 `packages/core/src/workflow.js` 是同一个模块实例，模块内的状态不会分叉。

- [ ] **Step 5: 修正 sync-templates 的路径**

`packages/core/scripts/sync-templates.js`，把
```js
const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const TEMPLATES = join(CLI_ROOT, 'templates');
```
改为
```js
const CORE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(CORE_ROOT, '..', '..');
const TEMPLATES = join(CORE_ROOT, 'templates');
```
并把头部注释里的 `cli/templates/` 改成 `packages/core/templates/`。

- [ ] **Step 6: 改 cli/package.json**

在 `dependencies` 增加 `"@agentteam/core": "*"`；`scripts` 改为只留 `"test": "node --test"`（删除 `sync`、`pretest`、`prepack`）；`files` 里删除 `"templates"`。删除 `cli/templates/`（生成物，已在 `.gitignore`）和 `cli/package-lock.json`（改由根目录统一生成）：
```bash
rm -rf cli/templates
git rm -f cli/package-lock.json
```
说明：此后 `cli` 不能单独发布（`@agentteam/core` 是 private），发布方式在 server/cli 计划里解决。

- [ ] **Step 7: 安装并跑全部测试**

Run：
```bash
npm install
npm test 2>&1 | grep -E "^(#|ℹ) (tests|pass|fail) "
```
Expected: 每个 workspace 的汇总里 `fail 0`；各 workspace 的 `tests` 之和等于 Step 1 的 N。若有测试因路径失败，只改路径，不改断言。常见原因：测试里读 `../templates`、`../package.json` 等相对路径。

- [ ] **Step 8: 检查点（不提交）**

Run: `git status --short`，把结果发给用户，等用户决定是否提交。

---

### Task 2: protocol 包（事件定义与校验）

**Files:**
- Create: `packages/protocol/src/index.js`
- Test: `packages/protocol/test/protocol.test.js`

**Interfaces:**
- Produces:
  - `PROTOCOL_VERSION: number`（当前 `1`）
  - `EVENT_FIELDS: Record<string, string[]>`，事件类型到必填业务字段
  - `makeEvent(type: string, data: object, opts: { seq: number, time?: string }): Event`，返回含 `v`、`seq`、`time`、`type` 与业务字段的对象，并经过校验
  - `validateEvent(event: unknown): Event`，不合法抛 `Error`（中文消息）

- [ ] **Step 1: 写失败的测试**

`packages/protocol/test/protocol.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, EVENT_FIELDS, makeEvent, validateEvent } from '../src/index.js';

// 协议只增不减：下面是已发布的事件与必填字段。以后可以新增事件、新增字段，不能删除或改名。
const PUBLISHED = {
  'stage.changed': ['stage'],
  'role.started': ['role', 'agent'],
  'role.output': ['role', 'chunk'],
  'role.files': ['role', 'files'],
  'role.finished': ['role'],
  'role.failed': ['role', 'error'],
  message: ['from', 'text'],
};

test('已发布的事件类型与必填字段不会被删除', () => {
  for (const [type, fields] of Object.entries(PUBLISHED)) {
    assert.ok(type in EVENT_FIELDS, `缺少事件类型 ${type}`);
    for (const field of fields) {
      assert.ok(EVENT_FIELDS[type].includes(field), `${type} 缺少必填字段 ${field}`);
    }
  }
});

test('makeEvent 生成带版本、序号、时间的事件', () => {
  const event = makeEvent('role.output', { role: 'qa', chunk: '你好' }, { seq: 3, time: '2026-11-02T00:00:00.000Z' });
  assert.deepEqual(event, {
    role: 'qa',
    chunk: '你好',
    v: PROTOCOL_VERSION,
    seq: 3,
    time: '2026-11-02T00:00:00.000Z',
    type: 'role.output',
  });
});

test('业务数据不能覆盖 v、seq、time、type', () => {
  const event = makeEvent('role.finished', { role: 'qa', seq: 99, v: 99, type: 'x' }, { seq: 1 });
  assert.equal(event.seq, 1);
  assert.equal(event.v, PROTOCOL_VERSION);
  assert.equal(event.type, 'role.finished');
});

test('缺必填字段、未知类型、坏序号、坏版本都会被拒绝', () => {
  assert.throws(() => makeEvent('role.failed', { role: 'qa' }, { seq: 1 }), /role\.failed 缺少字段 error/);
  assert.throws(() => makeEvent('nope', {}, { seq: 1 }), /未知事件类型/);
  assert.throws(() => makeEvent('role.finished', { role: 'qa' }, { seq: 0 }), /seq/);
  assert.throws(() => validateEvent({ v: 2, seq: 1, time: new Date().toISOString(), type: 'role.finished', role: 'qa' }), /协议版本/);
  assert.throws(() => validateEvent(null), /对象/);
});

test('多出来的字段不影响校验（旧客户端可以忽略新字段）', () => {
  const event = makeEvent('role.started', { role: 'qa', agent: 'claude', model: null, future: 1 }, { seq: 2 });
  assert.equal(event.future, 1);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w @agentteam/protocol`
Expected: FAIL，提示找不到 `../src/index.js`。

- [ ] **Step 3: 写实现**

`packages/protocol/src/index.js`：
```js
// 所有客户端（Web、将来的 APP 与小程序）共用的事件协议。
// 只增不减：可以新增事件类型、给事件新增字段，不能删除或改名；不兼容变化才升 PROTOCOL_VERSION。
export const PROTOCOL_VERSION = 1;

// 每种事件必须带的业务字段。新增字段不要放进来，这样旧版本的发送方仍然合法。
export const EVENT_FIELDS = {
  'stage.changed': ['stage'],
  'role.started': ['role', 'agent'],
  'role.output': ['role', 'chunk'],
  'role.files': ['role', 'files'],
  'role.finished': ['role'],
  'role.failed': ['role', 'error'],
  message: ['from', 'text'],
};

export function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('事件必须是对象');
  if (event.v !== PROTOCOL_VERSION) throw new Error(`不支持的协议版本：${event.v}`);
  if (!Number.isInteger(event.seq) || event.seq < 1) throw new Error(`seq 必须是正整数：${event.seq}`);
  if (typeof event.time !== 'string' || Number.isNaN(Date.parse(event.time))) {
    throw new Error(`time 不是有效时间：${event.time}`);
  }
  const fields = EVENT_FIELDS[event.type];
  if (!fields) throw new Error(`未知事件类型：${event.type}`);
  for (const field of fields) {
    if (event[field] === undefined) throw new Error(`${event.type} 缺少字段 ${field}`);
  }
  return event;
}

// 业务数据放在前面展开，保证 v、seq、time、type 不会被它覆盖。
export function makeEvent(type, data, { seq, time = new Date().toISOString() }) {
  return validateEvent({ ...data, v: PROTOCOL_VERSION, seq, time, type });
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -w @agentteam/protocol`
Expected: 5 个测试全部 PASS，`fail 0`。

- [ ] **Step 5: 检查点（不提交）**

列出改动文件给用户：`packages/protocol/src/index.js`、`packages/protocol/test/protocol.test.js`。

---

### Task 3: 事件日志（序号、落盘、订阅、续传）

**Files:**
- Create: `packages/core/src/store/events.js`
- Test: `packages/core/test/event-log.test.js`

**Interfaces:**
- Consumes: `makeEvent`（Task 2）。
- Produces: `EVENTS_FILE`（`team/events.jsonl` 的相对路径）；`createEventLog(root: string): Promise<EventLog>`。`EventLog`：
  - `emit(type, data?) → Event`：分配下一个 `seq`，写入内存、通知订阅者、追加到文件
  - `after(seq: number) → Event[]`：`seq` 大于给定值的全部事件
  - `subscribe(fn: (event) => void) → () => void`：返回取消订阅函数
  - `flush(): Promise<void>`：等待落盘完成；落盘出错时在这里抛出
  - `lastSeq: number`（只读属性）

- [ ] **Step 1: 写失败的测试**

`packages/core/test/event-log.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventLog, EVENTS_FILE } from '../src/store/events.js';

async function project() {
  return mkdtemp(join(tmpdir(), 'agentteam-events-'));
}

test('事件序号从 1 递增，并按行落盘', async () => {
  const root = await project();
  const log = await createEventLog(root);
  log.emit('role.started', { role: 'qa', agent: 'claude' });
  log.emit('role.finished', { role: 'qa' });
  await log.flush();

  assert.equal(log.lastSeq, 2);
  const lines = (await readFile(join(root, EVENTS_FILE), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.seq), [1, 2]);
  assert.equal(lines[0].type, 'role.started');
});

test('重新打开后接着上次的序号', async () => {
  const root = await project();
  const first = await createEventLog(root);
  first.emit('role.finished', { role: 'qa' });
  await first.flush();

  const second = await createEventLog(root);
  assert.equal(second.lastSeq, 1);
  const event = second.emit('role.finished', { role: 'qa' });
  assert.equal(event.seq, 2);
  assert.deepEqual(second.after(0).map((e) => e.seq), [1, 2]);
});

test('after 只返回序号更大的事件', async () => {
  const log = await createEventLog(await project());
  for (let i = 0; i < 3; i++) log.emit('role.output', { role: 'qa', chunk: String(i) });
  assert.deepEqual(log.after(1).map((e) => e.chunk), ['1', '2']);
  assert.deepEqual(log.after(3), []);
});

test('订阅者收到新事件，取消订阅后不再收到', async () => {
  const log = await createEventLog(await project());
  const seen = [];
  const off = log.subscribe((e) => seen.push(e.seq));
  log.emit('role.finished', { role: 'qa' });
  off();
  log.emit('role.finished', { role: 'qa' });
  assert.deepEqual(seen, [1]);
});

test('崩溃时可能留下写了一半的最后一行，读取时跳过它', async () => {
  const root = await project();
  await mkdir(join(root, 'team'), { recursive: true });
  const good = JSON.stringify({ v: 1, seq: 1, time: '2026-11-02T00:00:00.000Z', type: 'role.finished', role: 'qa' });
  await writeFile(join(root, EVENTS_FILE), `${good}\n{"v":1,"seq":2,"ti`, 'utf8');

  const log = await createEventLog(root);
  assert.equal(log.lastSeq, 1);
  assert.equal(log.emit('role.finished', { role: 'qa' }).seq, 2);
});

test('非法事件在 emit 时直接抛错，不占用序号', async () => {
  const log = await createEventLog(await project());
  assert.throws(() => log.emit('role.failed', { role: 'qa' }), /缺少字段 error/);
  assert.equal(log.lastSeq, 0);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w @agentteam/core -- test/event-log.test.js`
Expected: FAIL，找不到 `../src/store/events.js`。

- [ ] **Step 3: 写实现**

`packages/core/src/store/events.js`：
```js
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { makeEvent } from '@agentteam/protocol';

// 事件落盘位置：用户项目目录下，一行一个 JSON。刷新页面或换设备连接时，用它重放出当前视图。
export const EVENTS_FILE = join('team', 'events.jsonl');

async function readAll(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 进程崩溃时最后一行可能只写了一半：跳过，不让它挡住启动。
    }
  }
  return events;
}

export async function createEventLog(root) {
  const file = join(root, EVENTS_FILE);
  await mkdir(dirname(file), { recursive: true });
  const events = await readAll(file);
  let seq = events.length ? events[events.length - 1].seq : 0;
  const listeners = new Set();
  // 写盘串行排队，保证文件里的顺序与 seq 一致；出错记下来，由 flush 抛出。
  let writing = Promise.resolve();
  let writeError = null;

  return {
    emit(type, data = {}) {
      // 先校验再占用序号：非法事件不会留下空洞。
      const event = makeEvent(type, data, { seq: seq + 1 });
      seq = event.seq;
      events.push(event);
      writing = writing
        .then(() => appendFile(file, `${JSON.stringify(event)}\n`, 'utf8'))
        .catch((err) => {
          writeError = err;
        });
      for (const listener of listeners) listener(event);
      return event;
    },
    after(since) {
      return events.filter((e) => e.seq > since);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async flush() {
      await writing;
      if (writeError) throw writeError;
    },
    get lastSeq() {
      return seq;
    },
  };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -w @agentteam/core -- test/event-log.test.js`
Expected: 6 个测试全部 PASS。

- [ ] **Step 5: 检查点（不提交）**

列出改动文件给用户：`packages/core/src/store/events.js`、`packages/core/test/event-log.test.js`。

---

### Task 4: 流式输出的通用部分（runProcess、codex、gemini、deepseek、dispatch）

**Files:**
- Modify: `packages/core/src/adapters/process.js`、`codex.js`、`gemini.js`、`deepseek.js`；`packages/core/src/dispatch.js`
- Test: `packages/core/test/stream.test.js`

**Interfaces:**
- Produces:
  - `runProcess({ ..., onChunk?: (text: string) => void })`：stdout 每到一段就回调一次
  - `lineSplitter(onLine: (line: string) => void) → { push(text: string): void, end(): void }`：把任意切分的文本拼成完整的行
  - `trackOutput(onOutput?) → { onChunk?: (text) => void, finish(text: string): void }`：若过程中收到过输出，`finish` 不再重复发；否则 `finish` 把最终文本作为一段发出
  - 各适配器 `run({ ..., onOutput?: (text: string) => void })`
  - `dispatchTask({ ..., onOutput? })` 把 `onOutput` 传给适配器

- [ ] **Step 1: 写失败的测试**

`packages/core/test/stream.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess, lineSplitter, trackOutput } from '../src/adapters/process.js';
import { deepseekAdapter } from '../src/adapters/deepseek.js';

test('runProcess 把 stdout 逐段交给 onChunk，同时仍然返回完整输出', async () => {
  const chunks = [];
  const result = await runProcess({
    command: `node -e "process.stdout.write('a'); setTimeout(function(){process.stdout.write('b')}, 150)"`,
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10000,
    onChunk: (text) => chunks.push(text),
  });
  assert.equal(result.stdout, 'ab');
  assert.deepEqual(chunks, ['a', 'b']);
});

test('lineSplitter 把被任意切开的文本拼成完整的行，end 冲出最后不带换行的一行', () => {
  const lines = [];
  const splitter = lineSplitter((line) => lines.push(line));
  splitter.push('{"a":');
  splitter.push('1}\n{"b":2}\n\n{"c"');
  splitter.push(':3}');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  splitter.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('trackOutput：过程中有输出就不重复发最终文本，没有才补发一次', () => {
  const got = [];
  const streamed = trackOutput((t) => got.push(t));
  streamed.onChunk('过程');
  streamed.finish('最终');
  assert.deepEqual(got, ['过程']);

  const silent = [];
  const quiet = trackOutput((t) => silent.push(t));
  quiet.finish('最终');
  quiet.finish('');
  assert.deepEqual(silent, ['最终']);

  const none = trackOutput(undefined);
  assert.equal(none.onChunk, undefined);
  assert.doesNotThrow(() => none.finish('最终'));
});

test('deepseek 把每条模型回复交给 onOutput', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { role: 'assistant', content: '完成' } }] }),
  });
  const out = [];
  const result = await deepseekAdapter.run({
    prompt: 'x',
    cwd: await mkdtemp(join(tmpdir(), 'agentteam-ds-')),
    credential: { apiKey: 'k' },
    timeoutMs: 5000,
    fetchImpl,
    onOutput: (t) => out.push(t),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(out, ['完成\n']);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w @agentteam/core -- test/stream.test.js`
Expected: FAIL（`lineSplitter`、`trackOutput` 未导出，`onChunk` 未生效）。

- [ ] **Step 3: 改 process.js**

`runProcess` 的参数加 `onChunk`，并在 stdout 回调里转发：

```js
export function runProcess({ command, cwd, env, input = '', timeoutMs, onChunk }) {
```
```js
    child.stdout.on('data', (d) => {
      stdout += d;
      onChunk?.(String(d));
    });
```
在文件末尾追加：
```js
// 把任意切分的文本拼成完整的行（agent 的流式输出按行给出 JSON，但管道不保证按行到达）。
export function lineSplitter(onLine) {
  let buffer = '';
  const emit = (line) => {
    const trimmed = line.trim();
    if (trimmed) onLine(trimmed);
  };
  return {
    push(text) {
      buffer += text;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        emit(line);
      }
    },
    end() {
      const rest = buffer;
      buffer = '';
      emit(rest);
    },
  };
}

// 适配器的过程输出可能有，也可能没有（取决于 agent 是否在运行中往 stdout 写内容）。
// 过程中收到过输出就不再重复发最终文本；一次都没收到，结束时补发整段，保证界面不是空的。
export function trackOutput(onOutput) {
  let seen = false;
  return {
    onChunk: onOutput
      ? (text) => {
          seen = true;
          onOutput(text);
        }
      : undefined,
    finish(text) {
      if (onOutput && !seen && text) onOutput(text);
    },
  };
}
```

- [ ] **Step 4: 改 codex.js、gemini.js、deepseek.js**

`codex.js`：import 增加 `trackOutput`；`run` 签名增加 `onOutput`；
```js
  async run({ prompt, cwd, model, effort, timeoutMs, onOutput }) {
    const outputFile = join(tmpdir(), `agentteam-codex-${randomUUID()}.txt`);
    const out = trackOutput(onOutput);
    try {
      const proc = await runProcess({
        command: buildCommand({ model, effort, outputFile }),
        cwd,
        env: process.env,
        input: prompt,
        timeoutMs,
        onChunk: out.onChunk,
      });
```
并在 `const errorMessage = ...` 之后、`return` 之前加 `out.finish(text.trim());`。

`gemini.js`：`run` 签名增加 `onOutput`；把末尾两行
```js
    const errorMessage = parsed.error ? `gemini 返回错误：${parsed.error.message ?? '未知错误'}` : undefined;
    return toRunResult(proc, parsed.response ?? '', errorMessage);
```
改为
```js
    const errorMessage = parsed.error ? `gemini 返回错误：${parsed.error.message ?? '未知错误'}` : undefined;
    const text = parsed.response ?? '';
    // gemini 的 stdout 是一整块 JSON，不适合逐段展示，所以只在结束后发一次解析出来的正文。
    if (onOutput && !errorMessage && text) onOutput(text);
    return toRunResult(proc, text, errorMessage);
```

`deepseek.js`：`run` 的参数增加 `onOutput`；在 `messages.push(message);` 后加一行
```js
        if (onOutput && message.content) onOutput(`${message.content}\n`);
```

- [ ] **Step 5: 改 dispatch.js**

`dispatchTask` 的参数列表在 `emit = () => {},` 后加 `onOutput,`；`adapter.run` 调用改为
```js
  const result = await adapter.run({ prompt, cwd: root, model, effort, credential, timeoutMs, allowedCommands, addDirs: [TEMPLATES], onOutput });
```

- [ ] **Step 6: 运行全部 core 测试**

Run: `npm test -w @agentteam/core`
Expected: `stream.test.js` 4 个测试 PASS；其余测试仍全部通过（不改任何旧断言）。

- [ ] **Step 7: 检查点（不提交）**

列出改动文件给用户。并如实说明：codex 与 gemini 的 `onOutput` 接线只有 `trackOutput` 的单元测试，没有用真实 agent 跑过，真实验证在 Task 8。

---

### Task 5: claude 流式输出（先采集真实样本，再写解析）

**Files:**
- Create: `packages/core/test/fixtures/claude-stream.jsonl`
- Modify: `packages/core/src/adapters/claude.js`
- Test: `packages/core/test/stream.test.js`（追加）

**Interfaces:**
- Consumes: `runProcess` 的 `onChunk`、`lineSplitter`（Task 4）。
- Produces:
  - `buildCommand({ ..., stream?: boolean })`：`stream` 为真时用 `--output-format stream-json --verbose`
  - `parseStreamLine(line: string) → { texts: string[], result?: { text: string, isError: boolean } }`：不是合法 JSON 的行返回 `{ texts: [] }`
  - `claudeAdapter.run({ ..., onOutput? })`：传了 `onOutput` 走流式，否则走原来的 `json` 路径

- [ ] **Step 1: 采集真实输出样本**

先确认 claude 已登录：`claude auth status`。未登录就停下来请用户执行 `! claude auth login`，不要跳过这一步，也不要手写样本冒充真实输出。

Run（仓库根目录）：
```bash
mkdir -p packages/core/test/fixtures
printf '%s' "用一句话回答：1+1 等于几？" | claude -p --output-format stream-json --verbose --permission-mode acceptEdits > packages/core/test/fixtures/claude-stream.jsonl
```
再只保留 assistant 与 result 两类行（初始化事件里有本机路径与会话信息，不留进仓库）：
```bash
node -e "const fs=require('fs');const f='packages/core/test/fixtures/claude-stream.jsonl';const keep=fs.readFileSync(f,'utf8').split('\n').filter(l=>{try{const t=JSON.parse(l).type;return t==='assistant'||t==='result'}catch{return false}});fs.writeFileSync(f,keep.join('\n')+'\n')"
```
然后打开文件检查：(a) 有 `"type":"assistant"` 的行，`message.content` 里有 `"type":"text"` 的块；(b) 有 `"type":"result"` 的行，含 `result` 字符串和 `is_error` 布尔值；(c) 没有本机路径或密钥。
**如果真实格式和这里的假设不同**（字段名、嵌套层级、`--verbose` 是否必需），先如实记下差异，再按真实格式调整下面 Step 3 的 `parseStreamLine`，并把 Step 2 里手写的样本改成与真实格式一致。不要为了让测试通过而改样本。

- [ ] **Step 2: 写失败的测试（追加到 stream.test.js）**

文件顶部 import 增加：
```js
import { readFile } from 'node:fs/promises';
import { buildCommand as claudeCommand, parseStreamLine } from '../src/adapters/claude.js';
```
文件末尾追加：
```js
test('claude 流式命令：用 stream-json 与 --verbose，普通命令保持不变', () => {
  assert.equal(
    claudeCommand({ stream: true }),
    'claude -p --output-format stream-json --verbose --permission-mode acceptEdits',
  );
  assert.equal(claudeCommand(), 'claude -p --output-format json --permission-mode acceptEdits');
});

test('parseStreamLine：取出 assistant 的文本块与结束事件，忽略其他行', () => {
  const assistant = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '先看文件' }, { type: 'tool_use', name: 'Read' }, { type: 'text', text: '再改' }] },
  });
  assert.deepEqual(parseStreamLine(assistant), { texts: ['先看文件', '再改'] });

  const result = JSON.stringify({ type: 'result', result: '完成', is_error: false });
  assert.deepEqual(parseStreamLine(result), { texts: [], result: { text: '完成', isError: false } });

  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'user' })), { texts: [] });
  assert.deepEqual(parseStreamLine('不是 JSON'), { texts: [] });
});

test('真实采集的 claude 样本：能解析出文本和结束事件', async () => {
  const text = await readFile(new URL('./fixtures/claude-stream.jsonl', import.meta.url), 'utf8');
  const parsed = text.split('\n').filter(Boolean).map(parseStreamLine);
  assert.ok(parsed.flatMap((p) => p.texts).length > 0, '应能取出至少一段文本');
  const finals = parsed.filter((p) => p.result);
  assert.equal(finals.length, 1, '应有且只有一个结束事件');
  assert.equal(finals[0].result.isError, false);
  assert.ok(finals[0].result.text.length > 0);
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `npm test -w @agentteam/core -- test/stream.test.js`
Expected: 新增的 3 个测试 FAIL（`parseStreamLine` 未导出、`stream` 参数无效）。

- [ ] **Step 4: 改 claude.js**

import 行改为：
```js
import { runProcess, lineSplitter, assertSafeToken, quotePath, toRunResult } from './process.js';
```
`buildCommand` 的头两行（签名与 `const parts`）改为：
```js
export function buildCommand({ model, effort, allowedCommands = [], addDirs = [], stream = false } = {}) {
  // stream-json 需要同时带 --verbose（以 Step 1 的实测为准，不符就按实测改）。
  const format = stream ? ['stream-json', '--verbose'] : ['json'];
  const parts = ['claude', '-p', '--output-format', ...format, '--permission-mode', 'acceptEdits'];
```
在 `buildEnv` 之后新增：
```js
// 流式输出每行一个 JSON。只关心两类：assistant 里的文本块（实时展示），result（最终结果）。
export function parseStreamLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return { texts: [] };
  }
  if (event.type === 'assistant') {
    const blocks = event.message?.content ?? [];
    return { texts: blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text) };
  }
  if (event.type === 'result') {
    return { texts: [], result: { text: event.result ?? '', isError: Boolean(event.is_error) } };
  }
  return { texts: [] };
}
```
把文件末尾的 `claudeAdapter`（从 `export const claudeAdapter = {` 到文件结尾）整体替换为：
```js
export const claudeAdapter = {
  id: 'claude',
  canEditFiles: true,

  async run({ prompt, cwd, model, effort, credential = {}, timeoutMs, allowedCommands = [], addDirs = [], onOutput }) {
    const stream = typeof onOutput === 'function';
    let final = null;
    const lines = lineSplitter((line) => {
      const parsed = parseStreamLine(line);
      for (const text of parsed.texts) onOutput(`${text}\n`);
      if (parsed.result) final = parsed.result;
    });

    const { code, stdout, stderr, timedOut } = await runProcess({
      command: buildCommand({ model, effort, allowedCommands, addDirs, stream }),
      cwd,
      env: buildEnv(credential),
      input: prompt,
      timeoutMs,
      onChunk: stream ? (text) => lines.push(text) : undefined,
    });

    if (stream) {
      lines.end();
      if (!final) {
        // 超时时没有结束事件是正常的，让 toRunResult 报超时，不要被这条覆盖。
        const message = timedOut ? undefined : 'claude 流式输出中没有结束事件，无法取得结果';
        return toRunResult({ code, stderr, timedOut }, '', message);
      }
      const errorMessage = final.isError ? `claude 返回错误：${final.text}` : undefined;
      return toRunResult({ code, stderr, timedOut }, final.text, errorMessage);
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return toRunResult({ code, stderr, timedOut }, '', 'claude 输出不是 JSON，无法解析');
    }
    const errorMessage = parsed.is_error ? `claude 返回错误：${parsed.result}` : undefined;
    return toRunResult({ code, stderr, timedOut }, parsed.result ?? '', errorMessage);
  },
};
```

- [ ] **Step 5: 运行，确认通过**

Run: `npm test -w @agentteam/core`
Expected: `stream.test.js` 全部 PASS；`adapters.test.js` 里原有的 claude 命令断言（`claude -p --output-format json --permission-mode acceptEdits`）不改仍 PASS。

- [ ] **Step 6: 检查点（不提交）**

列出改动文件给用户，并附上 Step 1 采集到的真实格式与假设是否一致的结论。

---

### Task 6: workflow 的暂停改为可注入

**Files:**
- Modify: `packages/core/src/workflow.js`（`pauseRequested` 及其 3 处调用）
- Test: `packages/core/test/workflow.test.js`（追加）

**Interfaces:**
- Produces: `deps.shouldPause?: () => boolean`。提供时，工作流用它判断是否暂停；不提供时仍用模块级标志（`requestPause()` 继续可用，终端版不受影响）。
- Consumes: 无。

- [ ] **Step 1: 写失败的测试（追加到 workflow.test.js 末尾）**

```js
test('deps.shouldPause 可以替代全局暂停标志', async () => {
  const root = await project();
  const { dispatch } = fakeDispatch();
  let pause = false;
  const deps = {
    // 需求角色做完后才请求暂停，流程应在进入架构师之前停下。
    dispatch: async (args) => {
      const result = await dispatch(args);
      pause = true;
      return result;
    },
    shouldPause: () => pause,
  };

  const reply = await handleMessage({ root, text: '做个登录功能', deps });
  assert.equal(reply.stage, 'paused');
  const state = await loadState(root);
  assert.equal(state.pending.step, 'architecture');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w @agentteam/core -- test/workflow.test.js`
Expected: 新测试 FAIL（`reply.stage` 是 `arch_review`，因为 `shouldPause` 被忽略）。

- [ ] **Step 3: 改 workflow.js**

把
```js
function pauseRequested() {
  return pausing;
}
```
改为
```js
// 暂停标志可以由调用方注入（每个运行会话各自一个）；不注入时用模块级标志，终端版继续沿用。
function pauseRequested(deps) {
  return deps.shouldPause ? deps.shouldPause() : pausing;
}
```
然后把文件中全部三处 `pauseRequested()` 调用改为 `pauseRequested(deps)`：`doBuild` 里两处（循环内 `if (pauseRequested()) return { ok: true, paused: true };` 与交付报告前同样一行）、`runStep` 里一处（`if (pauseRequested()) return pauseAt(state, 'architecture');`）。这三处所在函数的参数里都已有 `deps`。

用搜索确认没有遗漏：`pauseRequested()` 不应再出现。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -w @agentteam/core -- test/workflow.test.js`
Expected: 新测试与原有暂停相关测试（使用 `requestPause()` 的那几个）全部 PASS。

- [ ] **Step 5: 检查点（不提交）**

列出改动文件给用户。

---

### Task 7: Session（每个项目一个运行会话）

**Files:**
- Create: `packages/core/src/session.js`
- Test: `packages/core/test/session.test.js`

**Interfaces:**
- Consumes: `createEventLog`（Task 3）、`handleMessage`、`loadState`（`workflow.js`，含 Task 6 的 `deps.shouldPause`）、`dispatchTask`（含 Task 4 的 `onOutput`）、`resolveAssignments(root)`（`assign.js`，返回以角色为键、含 `agent`/`model`/`effort` 的对象）。
- Produces:
  - `class BusyError extends Error`
  - `createSession({ root: string, dispatch?: Function }): Promise<Session>`；`dispatch` 默认 `dispatchTask`，测试时注入假的
  - `Session`：
    - `send(text: string): Promise<{ text: string, stage: string }>`，同一时刻只允许一个运行，否则抛 `BusyError`
    - `requestPause(): boolean`，返回是否为本次运行的首次请求
    - `state(): Promise<object>`，`loadState` 的内容加 `running: boolean` 与 `lastSeq: number`
    - `log`：Task 3 的 `EventLog`
  - 事件发射规则：`send` 开始时发 `message`（`from: 'user'`）；每个角色发 `role.started`（含 `agent`/`model`/`effort`）→ 若干 `role.output` → `role.files` → `role.finished` 或 `role.failed`；结束时发 `message`（`from: 'team'`）与 `stage.changed`

- [ ] **Step 1: 写失败的测试**

`packages/core/test/session.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, BusyError } from '../src/session.js';
import { EVENTS_FILE } from '../src/store/events.js';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'agentteam-session-'));
  await mkdir(join(root, 'team', 'tasks'), { recursive: true });
  return root;
}

// 假的派发：写出任务卡"交付"清单里的文件，并通过 onOutput 吐一段文字。
function fakeDispatch({ onCall, fail = [] } = {}) {
  return async ({ root, taskId, role, onOutput }) => {
    await onCall?.(role);
    onOutput?.(`${role} 工作中\n`);
    if (fail.includes(role)) return { ok: false, text: '', error: `${role} 模拟失败`, changed: [], log: null };
    const card = await readFile(join(root, 'team', 'tasks', `${taskId}.md`), 'utf8');
    const lines = card.split('\n');
    const outs = lines.slice(lines.indexOf('交付：') + 1).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    for (const out of outs) {
      const full = join(root, out);
      await mkdir(join(full, '..'), { recursive: true });
      const body = out.endsWith('-summary.md') ? '## 方案 A：Go + Vue\n\n## 方案 B：Node + React\n' : `# ${out}\n`;
      await writeFile(full, body, 'utf8');
    }
    return { ok: true, text: '', changed: outs, log: null };
  };
}

test('一次对话产生按顺序排列的结构化事件，并落盘', async () => {
  const root = await project();
  const session = await createSession({ root, dispatch: fakeDispatch() });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'arch_review');

  const events = session.log.after(0);
  assert.deepEqual(
    events.map((e) => e.type),
    [
      'message',
      'role.started', 'role.output', 'role.files', 'role.finished',
      'role.started', 'role.output', 'role.files', 'role.finished',
      'message',
      'stage.changed',
    ],
  );
  assert.deepEqual(events.filter((e) => e.type === 'role.started').map((e) => e.role), ['req-analyst', 'architect']);
  assert.equal(events[0].from, 'user');
  assert.equal(events[9].from, 'team');
  assert.equal(events[10].stage, 'arch_review');
  assert.equal(events[1].agent, 'claude', '没有分配时角色默认由 claude 执行');
  assert.equal(events[2].chunk, 'req-analyst 工作中\n');
  assert.deepEqual(events[3].files, ['docs/requirements/REQ-001.md']);

  await session.log.flush();
  const onDisk = (await readFile(join(root, EVENTS_FILE), 'utf8')).trim().split('\n');
  assert.equal(onDisk.length, events.length);
});

test('角色失败时发 role.failed，阶段变为 failed', async () => {
  const root = await project();
  const session = await createSession({ root, dispatch: fakeDispatch({ fail: ['req-analyst'] }) });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'failed');
  const failed = session.log.after(0).find((e) => e.type === 'role.failed');
  assert.equal(failed.role, 'req-analyst');
  assert.match(failed.error, /模拟失败/);
  assert.equal(session.log.after(0).at(-1).stage, 'failed');
});

test('同一时刻只允许一个运行：运行中再发消息抛 BusyError，结束后可以继续', async () => {
  const root = await project();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const session = await createSession({ root, dispatch: fakeDispatch({ onCall: () => gate }) });

  const first = session.send('做个登录功能');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await session.state()).running, true);
  await assert.rejects(session.send('再来一个'), BusyError);

  release();
  await first;
  const state = await session.state();
  assert.equal(state.running, false);
  assert.equal(state.stage, 'arch_review');
  assert.equal(state.lastSeq, session.log.lastSeq);
});

test('requestPause 让流程在当前角色结束后停下，且只影响本次运行', async () => {
  const root = await project();
  let session;
  session = await createSession({
    root,
    dispatch: fakeDispatch({
      onCall: (role) => {
        if (role === 'req-analyst') assert.equal(session.requestPause(), true);
      },
    }),
  });

  const reply = await session.send('做个登录功能');
  assert.equal(reply.stage, 'paused');
  assert.deepEqual(
    session.log.after(0).filter((e) => e.type === 'role.started').map((e) => e.role),
    ['req-analyst'],
    '暂停后不应启动架构师',
  );

  // 回复"继续"是新的一次运行：上一次的暂停请求不能带过来。
  const next = await session.send('继续');
  assert.equal(next.stage, 'arch_review');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test -w @agentteam/core -- test/session.test.js`
Expected: FAIL，找不到 `../src/session.js`。

- [ ] **Step 3: 写实现**

`packages/core/src/session.js`：
```js
import { createEventLog } from './store/events.js';
import { handleMessage, loadState } from './workflow.js';
import { dispatchTask } from './dispatch.js';
import { resolveAssignments } from './assign.js';

export class BusyError extends Error {
  constructor() {
    super('已有流程在运行，请等它完成，或先请求暂停');
    this.name = 'BusyError';
  }
}

// 每个项目目录一个会话：持有自己的事件日志、暂停标志和"是否在运行"。
// 取代 workflow.js 里的模块级暂停变量，这样一个服务可以同时管理多个项目而互不干扰。
export async function createSession({ root, dispatch = dispatchTask }) {
  const log = await createEventLog(root);
  let running = false;
  let pause = false;

  // 包一层派发：把角色的开始、实时输出、产物、结果变成事件，工作流本身不需要知道事件的存在。
  async function observedDispatch(args) {
    const { role } = args;
    const assigned = (await resolveAssignments(root).catch(() => ({})))[role] ?? {};
    log.emit('role.started', {
      role,
      agent: assigned.agent ?? 'unknown',
      model: assigned.model ?? null,
      effort: assigned.effort ?? null,
    });
    let result;
    try {
      result = await dispatch({ ...args, onOutput: (chunk) => log.emit('role.output', { role, chunk }) });
    } catch (err) {
      // 派发前的检查（未认证、未分配等）会抛错：工作流会把它转成可重试的失败步骤，这里只负责留下事件。
      log.emit('role.failed', { role, error: err.message });
      throw err;
    }
    log.emit('role.files', { role, files: result.changed ?? [] });
    if (result.ok) log.emit('role.finished', { role });
    else log.emit('role.failed', { role, error: result.error ?? '未知错误' });
    return result;
  }

  return {
    log,

    async send(text) {
      if (running) throw new BusyError();
      running = true;
      pause = false;
      try {
        log.emit('message', { from: 'user', text });
        const reply = await handleMessage({
          root,
          text,
          deps: { dispatch: observedDispatch, shouldPause: () => pause },
        });
        log.emit('message', { from: 'team', text: reply.text });
        log.emit('stage.changed', { stage: reply.stage });
        return reply;
      } finally {
        running = false;
      }
    },

    // 返回是否为本次运行的首次请求（界面据此决定提示文字）。
    requestPause() {
      const first = !pause;
      pause = true;
      return first;
    },

    async state() {
      return { ...(await loadState(root)), running, lastSeq: log.lastSeq };
    },
  };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test -w @agentteam/core -- test/session.test.js`
Expected: 4 个测试 PASS。若"事件顺序"断言失败，先打印 `session.log.after(0).map((e) => e.type)` 对照，别直接改断言。

- [ ] **Step 5: 运行根目录全部测试**

Run: `npm test 2>&1 | grep -E "^(#|ℹ) (tests|pass|fail) "`
Expected: 所有 workspace `fail 0`；旧测试总数不少于 Task 1 记录的 N。

- [ ] **Step 6: 检查点（不提交）**

列出改动文件给用户。

---

### Task 8: 文档同步与一次真实验证

**Files:**
- Modify: `docs/superpowers/specs/2026-10-30-web-console-design.md`、`docs/backlog.md`、`CHANGELOG.md`
- 临时文件：`<系统临时目录>/stream-check.mjs`（验证后删除，不放进仓库）

- [ ] **Step 1: 把规格里已核实的事实改正**

`docs/superpowers/specs/2026-10-30-web-console-design.md`：

1. 把
```
取值沿用现有 `stage`：`idle`、`arch_review`、`delivered`、`closed`、`failed`、`paused`。执行中各阶段的取值在迁移时从 `workflow.js` 核对后补入协议，目前未确认 |
```
改为
```
取值沿用现有 `stage`：`idle`、`arch_review`、`delivered`、`closed`、`failed`、`paused`（已对照 `workflow.js` 核实）。工作流没有"执行中"阶段，运行状态由 `role.started` / `role.finished` / `role.failed` 事件和 `/api/state` 里的 `running` 字段表示 |
```
2. 把 `| \`message\` | 团队对用户的回复，对应 \`conversation.md\` |` 改为 `| \`message\` | 一条对话，带 \`from\`（\`user\` 或 \`team\`）与 \`text\`，对应 \`conversation.md\` |`。
3. 把目录树里 `│  │  ├─ roles/                角色提示词` 改为 `│  │  ├─ templates/            团队公约与角色提示词（由 scripts/sync-templates.js 从仓库根目录复制，根目录是唯一来源）`。
4. 在第 6 节末尾补一句：`取消运行中的角色需要把 AbortSignal 贯穿 runProcess，见 backlog B-005，随 server 计划实现。`

- [ ] **Step 2: 记入遗留议题**

在 `docs/backlog.md` 末尾追加：
```markdown

### B-005 取消运行中的角色
- 背景：spec 第 6 节要求取消时强制终止子进程，现有代码只有暂停（当前角色写完后停下），没有取消。
- 方案方向：`runProcess` 接收 `AbortSignal`，触发时调用 `killTree`；Session 增加 `cancel()`。
- 计划：随 server 计划实现。
```

- [ ] **Step 3: 写 CHANGELOG**

`CHANGELOG.md` 的 `[未发布]` → `### 变更` 里，在以 `- 移除旧的全局模式配置` 开头的那一条之后追加：
```markdown
- 仓库改为 npm workspaces：适配器、状态机、派发、凭证迁入 `packages/core`（`@agentteam/core`），新增 `packages/protocol`（`@agentteam/protocol`）。`cli/` 暂时保留终端交互代码，被迁走的模块在 `cli/src` 里留转发文件，对外行为不变。迁移期间 `cli` 不能单独发布。
- 引擎新增：事件日志（`team/events.jsonl`，每条事件带递增序号，可按序号续传）、各 agent 的实时文本输出（适配器 `run` 新增可选参数 `onOutput`）、每个项目目录一个运行会话（`Session`，替代模块级暂停变量；工作流新增可注入的 `deps.shouldPause`，终端版的 `requestPause()` 不受影响）。
```
在同一版本的 `### 说明` 里追加一条：`- 未验证：codex 与 gemini 的实时输出只测了接线辅助函数，未用真实 agent 跑过；claude 的流式输出以采集到的真实样本测试了解析。`（若 Step 4 真实验证了 claude 端到端，把 claude 一并写入"已验证"。）

- [ ] **Step 4: 用真实 claude 跑一次端到端的流式验证**

写临时脚本到系统临时目录（不放进仓库）。先取路径：`node -p "require('os').tmpdir()"`，记为 `<TMP>`。

`<TMP>/stream-check.mjs`：
```js
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { dispatchTask } = await import(pathToFileURL(process.argv[2]).href);
const root = await mkdtemp(join(tmpdir(), 'agentteam-live-'));
await mkdir(join(root, 'team', 'tasks'), { recursive: true });
await writeFile(join(root, 'team', 'tasks', 'T-001.md'), '# T-001\n目标：只回答 1+1 等于几，不要读写任何文件\n', 'utf8');

const t0 = Date.now();
const result = await dispatchTask({
  root,
  taskId: 'T-001',
  role: 'qa',
  onOutput: (text) => console.log(`[+${Date.now() - t0}ms] ${JSON.stringify(text)}`),
});
console.log(`[+${Date.now() - t0}ms] 结束 ok=${result.ok} error=${result.error ?? '无'}`);
```
Run（仓库根目录）：
```bash
node "<TMP>/stream-check.mjs" "$(pwd)/packages/core/src/dispatch.js"
```
Expected: 先出现至少一行 `[+…ms] "…"`（实时输出），最后一行 `结束 ok=true`，且最后一行的耗时明显大于第一行输出的耗时。
若抛"尚未认证"，说明本机没有保存 claude 的认证记录：停下来请用户执行 `! node cli/bin/agentteam.js auth claude`，不要跳过。
这一步会真实调用一次 claude（消耗少量额度），做完后删除临时脚本和临时项目：`rm "<TMP>/stream-check.mjs"`。

- [ ] **Step 5: 最终全量测试**

Run: `npm test 2>&1 | grep -E "^(#|ℹ) (tests|pass|fail) "`
Expected: 全部 workspace `fail 0`。

- [ ] **Step 6: 检查点（不提交）**

运行 `git status --short`，把改动清单、Step 4 的实际输出、以及"哪些仍未验证（codex、gemini、deepseek 真实流式）"一并汇报给用户，由用户决定提交。

---

## 自查记录

**Spec 覆盖：** 3 节目录与迁移对应表 → Task 1；4.1 事件 → Task 2、3、7；5 实时输出流 → Task 4、5（claude `stream-json`、codex、deepseek、gemini）；6 运行会话与暂停 → Task 6、7；"同一项目只允许一个运行（409）"的引擎侧 → Task 7 的 `BusyError`（HTTP 409 映射在 server 计划）；7 测试策略中 core 与 protocol 与适配器回放 → 各任务的测试。**未覆盖并已说明：** 4.2 接口、server、web、cli 入口、取消运行中角色（B-005）、服务重启后从 `state.json` 与 `events.jsonl` 恢复（引擎侧已具备：`createEventLog` 重读 + `loadState`，对外暴露在 server 计划）。

**类型一致性：** `onOutput(text: string)` 在 Task 4 定义，Task 5、7 同名同签名使用；`createEventLog`/`emit`/`after`/`subscribe`/`flush`/`lastSeq` 在 Task 3 定义，Task 7 按同名使用；`deps.shouldPause` 在 Task 6 定义，Task 7 使用；事件字段名与 Task 2 的 `EVENT_FIELDS` 一致（`message` 用 `from`/`text`，`role.files` 用 `files`）。
