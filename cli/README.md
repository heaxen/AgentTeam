# agentteam

AI 开发团队的命令行工具。在已有项目里写入团队公约和角色说明书，并通过两种方式调用模型：

- **订阅模式（subscription）**：调用本机已登录的 Claude Code（`claude -p`），消耗订阅额度。
- **API 模式（api）**：使用你自己的 Anthropic API key，按 token 计费。

> 状态：0.5.0。`init`、`config`、`doctor`、`run`、`agents`、`auth`、`assign` 已实现；`dispatch` 已支持 claude、codex、gemini，其余 agent 的接入进度见 `docs/adapters.md`。

## 安装与使用

```bash
npm install -g agentteam          # 发布后；本地开发可在本目录执行 npm link

cd 你的项目
agentteam init                    # 写入 AGENTS.md、角色说明书、目录结构；已存在的文件不会覆盖

agentteam config set mode subscription   # 或 api
agentteam config set apiKey sk-...       # 仅 api 模式需要，也可用环境变量 ANTHROPIC_API_KEY
agentteam doctor                  # 检查当前模式是否可用
agentteam run "你好"              # 调用一次模型，验证连通性
```

配置保存在 `~/.agentteam/config.json`。环境变量优先于配置文件：`AGENTTEAM_MODE`、`AGENTTEAM_MODEL`、`ANTHROPIC_API_KEY`。

### 把角色交给 agent 执行

```bash
agentteam agents                          # 查看 agent 与认证状态
agentteam auth claude                     # 订阅：启动该 agent 自己的登录
agentteam auth gemini --from-env          # 个人 API：从环境变量保存 key（不回显）
agentteam assign backend-dev codex        # 指定角色使用的 agent
agentteam dispatch T-001 backend-dev      # 把 team/tasks/T-001.md 交给 backend-dev 执行
```

每次派发在 `team/runs/` 下写一份运行记录（提示词、回复、改动文件清单）。派发前会检查 agent 是否已接入、是否已认证，不满足时直接报错，不会启动 agent。

允许执行的验证命令写在项目的 `team/allowed-commands.json`：

```json
{ "version": 1, "commands": ["npm test"] }
```

未列入的命令，agent 不能执行。Gemini 在无头模式下不能执行任何 shell 命令。

## 开放接口（为 Web / 移动端 / 小程序预留）

1. **JSON 事件输出**：所有命令加 `--json` 时，以 JSON 行输出事件，每行包含 `v`（schema 版本）、`type`、`time`。外部界面只需读取这些事件。字段只增不减，变更时升级 `v`。
2. **模型调用抽象**：`src/providers/` 下每种模式实现同一个 `run()` 接口。新增模型来源只需加一个文件。
3. **文件即状态**：协作状态保存在项目的 `team/`、`docs/` 目录，不依赖 CLI 的内存状态。任何界面都可以直接读取这些文件。

## 开发

```bash
npm install
npm test          # 先从仓库根目录同步 templates/，再运行测试
```

`templates/` 由 `scripts/sync-templates.js` 从仓库根目录的 `AGENTS.md`、手册、`prompts/`、`stacks/_template.md` 生成，不要直接编辑，也不提交到仓库（见 `.gitignore`）。发布前 `prepack` 会自动同步。

## 许可

MIT
