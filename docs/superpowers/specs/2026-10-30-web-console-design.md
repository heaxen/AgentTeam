# AgentTeam Web 指挥台设计

日期：2026-10-30
状态：待用户审阅

## 1. 目标与范围

用户在浏览器里像指挥团队一样使用数字员工：

- 每个角色可单独指定 agent、模型、思考强度。
- 整条工作流（需求、方案、后端、前端、测试、交付）以流水线形式可视化，并能看到各角色的实时文本输出。
- 工作目录就是用户当前的项目，已有项目直接可用。

第一版范围：

- 部署形态：本机服务。`npx agentteam` 启动服务并打开浏览器；服务只监听 `127.0.0.1`，凭证留在本机，不做账号体系。
- 可视化深度：角色级流水线加实时文本输出流。不做工具调用时间线。
- 客户端：只做 Web。APP、小程序不创建目录，只保证协议层可被它们复用。

不在第一版：远程访问与鉴权、多用户、工具调用时间线、治理文档（门禁、MSG、ADR）的界面、原型自动化。

## 2. 架构与依赖方向

```
apps/web (以及未来的 mobile、miniprogram)  →  packages/protocol
packages/server                            →  packages/core, packages/protocol
packages/core                              →  不依赖 HTTP 或 UI
packages/cli                               →  packages/server
```

- `core`：引擎，负责跑角色、管状态、发事件。
- `protocol`：所有客户端共用的契约，包含事件类型、接口 schema、版本号。
- `server`：HTTP 加 SSE 的薄层，调用 core，并托管 web 的构建产物。
- `web`：Vite + React 纯客户端，只认 protocol。
- `cli`：极薄入口，启动 server 并打开浏览器。

## 3. 目录结构

```
agentteam/
├─ package.json                npm workspaces
├─ apps/
│  └─ web/src/
│     ├─ pipeline/             流水线视图（角色卡片、状态）
│     ├─ role-panel/           角色详情、实时输出流
│     ├─ composer/             需求输入、修改意见、继续、重试、取消
│     └─ settings/             角色分配（agent、模型、强度）
├─ packages/
│  ├─ protocol/                事件类型、接口 schema、版本号
│  ├─ core/src/
│  │  ├─ adapters/             claude、codex、gemini、deepseek
│  │  ├─ workflow/             状态机
│  │  ├─ templates/            团队公约与角色提示词（由 scripts/sync-templates.js 从仓库根目录复制，根目录是唯一来源）
│  │  ├─ session/              每个项目目录一个运行会话
│  │  ├─ store/                state.json、events.jsonl、runs 的读写
│  │  └─ credentials/          凭证与认证
│  ├─ server/
│  └─ cli/
└─ docs/
   ├─ superpowers/specs/       设计文档
   └─ backlog.md               遗留议题
```

与现有代码的对应：

| 现有 | 去向 |
| --- | --- |
| `cli/src/adapters/*` | 迁入 `core/adapters` |
| `workflow.js`、`dispatch.js` | 迁入 `core/workflow` |
| `agents.js`、`assign.js`、`auth.js`、`credentials.js`、`allowlist.js` | 迁入 `core` |
| `prompts/*` | 迁入 `core/roles` |
| `events.js` | 扩展为 `protocol` |
| `tui.js`、`chat.js`、`select.js` 等终端交互 | 不迁移，保留在旧目录，Web 版跑通后删除 |

用户项目目录下的 `team/state.json`、`team/runs/`、`team/conversation.md` 格式不变，新增 `team/events.jsonl`。

## 4. 协议

### 4.1 事件

每条事件带 `v`（协议版本）、`seq`（单调递增序号）、`time`。字段只增不减，变更时升级 `v`。

| 事件 | 含义 |
| --- | --- |
| `stage.changed` | 流程阶段变化，取值沿用现有 `stage`：`idle`、`arch_review`、`delivered`、`closed`、`failed`、`paused`（已对照 `workflow.js` 核实）。工作流没有"执行中"阶段，运行状态由 `role.started` / `role.finished` / `role.failed` 事件和 `/api/state` 里的 `running` 字段表示 |
| `role.started` / `role.finished` / `role.failed` | 角色开始、完成、失败，带 agent、模型、强度；失败带原因 |
| `role.output` | 实时文本片段，带 `role`、`chunk` |
| `role.files` | 角色结束时的产物与改动文件清单 |
| `message` | 一条对话，带 `from`（`user` 或 `team`）与 `text`，对应 `conversation.md` |

事件同时落盘到 `team/events.jsonl`。刷新页面或换设备连接时，可从落盘事件重放出当前视图。

### 4.2 接口（HTTP + SSE）

| 接口 | 作用 |
| --- | --- |
| `GET /api/state` | 当前完整状态，首次加载和断线重连时调用 |
| `GET /api/events?after=<seq>` | SSE 事件流，按 `seq` 续传 |
| `POST /api/message` | 提需求、选方案、给意见、继续、重试，语义沿用现有 `handleMessage`。立即返回 202，进度与结果经事件流送达 |
| `POST /api/pause` | 请求暂停：当前角色写完后停下。没有运行中的流程返回 409 |
| `POST /api/cancel` | 取消：强制终止当前角色的进程树。没有运行中的流程返回 409 |
| `GET /api/agents` | 可选的 agent、模型、思考强度，以及是否已认证（不含凭证内容） |
| `GET /api/roles`、`PUT /api/roles` | 读取与修改每个角色的 agent、模型、强度 |
| `POST /api/auth/:agent` | 认证。`{ method: 'api', apiKey }` 保存 API key；`{ method: 'confirm' }` 记录用户已在终端完成订阅登录（订阅登录需要终端交互，无法经 HTTP 完成） |

同一项目同时只允许一个运行中的流程，第二个请求返回 409。所有请求的 `Host` 必须是本机地址，带 `Origin` 时必须是本机页面，否则返回 403（浏览器里的任意网页都能向 127.0.0.1 发请求，而服务能指挥带编辑权限的 agent）。请求体上限 64 KB。

Web 客户端（`apps/web`）为纯展示层：状态与事件全部来自上述接口，操作全部转发给上述接口。开发启动 `npm run dev -w apps/web`；生产构建 `npm run build -w apps/web`，产物由 `packages/server --web apps/web/dist` 同源托管。界面分四区：流水线（五个角色的状态）、对话记录、角色输出流、输入区（需求 / 方案意见 / 继续 / 重试 / 暂停 / 取消）；右栏为角色分配（agent / 模型 / 强度）与认证。

## 5. 实时输出流

- `runProcess` 增加可选参数 `onChunk(text)`，逐段转发 stdout。
- `adapter.run()` 增加可选参数 `onOutput(text)`。不传时行为与现在相同，现有测试不变。
- claude：由 `--output-format json` 改为 `stream-json`，逐行解析文本片段，最终结果取结束事件里的 `result`。参数组合必须先用真实命令验证，再写入实现（计划里排第一个小实验）。
- codex：最终回复仍读 `-o` 文件，过程输出取 stdout。
- deepseek：在自有工具循环中直接调用 `onOutput`。
- gemini：第一版只在结束后提供整段文本。
- 各 agent 的输出统一为 `role.output` 的纯文本 `chunk`，页面不感知来源差异。

## 6. 运行会话、暂停与错误

- `core/session` 为每个项目目录持有一个会话，包含暂停标志、当前运行和事件序号。取代现有 `workflow.js` 里的模块级全局变量 `pausing`。
- 暂停语义不变：当前角色写完后停下，不强杀。取消时强制终止子进程（沿用 `killTree`）。
- 适配器失败、超时、认证缺失、未改应用代码，沿用现有"步骤失败，可重试"逻辑，并发出 `role.failed`。
- SSE 断线后客户端带 `after=<seq>` 重连。服务重启后从 `state.json` 与 `events.jsonl` 恢复，已完成的角色不重做。
- 服务默认只监听 `127.0.0.1`。开放远程访问前必须先加访问令牌（见遗留议题）。
- 取消运行中的角色：`runProcess` 接收 `AbortSignal`，触发后终止子进程树；`Session.cancel()` 同时置暂停标志，被取消的角色记为失败（可重试），流程不再继续往下走。

## 7. 测试策略

- `core`：沿用 `node:test`，通过 `deps` 注入假 dispatch，不真实调用 agent。
- `protocol`：事件 schema 的契约测试，保证只增不减。
- `server`：用假 core 测接口与 SSE 续传。
- `web`：组件测试，加一次 Playwright 端到端，覆盖从提需求到交付的主线。
- 适配器流式解析：用录制的真实输出样本做回放测试。

## 8. 迁移顺序

1. 搭 monorepo 骨架，把 `core` 相关文件迁入并保持现有测试通过。
2. 实验：验证 claude `stream-json` 的参数与输出格式。
3. 适配器加 `onOutput`，`workflow` 发结构化事件，落盘 `events.jsonl`。
4. 实现 `session`，替换全局暂停变量。
5. 实现 `protocol` 与 `server`。
6. 实现 `web`：先流水线与输出流，再 composer，最后 settings。
7. 实现 `cli` 入口，Web 版跑通后删除旧的终端交互代码。

## 9. 风险与未验证项

- claude `stream-json` 的参数与事件格式尚未实测。
- codex、gemini、deepseek 适配器此前也未实跑，流式化后仍需各跑一次真实任务。
- 对话流程至今未用真实 agent 端到端跑通（见 CHANGELOG「说明」），迁移不会自动解决这一点。第一步之后应尽快用一个真实中等需求跑通一次。

## 10. 遗留议题

见 `docs/backlog.md`。
