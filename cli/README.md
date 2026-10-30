# agentteam

AI 开发团队的命令行工具。你用一段对话描述需求，团队里的每个角色（PM、架构师、后端、前端、测试……）由你指定的 agent 执行，所有过程都写进项目的文件里。

> 状态：0.5.0。对话流程的第一版已实现，但尚未用真实 agent 端到端跑通；各 agent 的执行适配器与接入进度见 `docs/adapters.md`。

## 安装与使用

```bash
npm install -g agentteam          # 发布到 npm 之后可用；开发阶段见下方"本地测试"

cd 你的项目（可以是空目录）
agentteam                         # 进入对话
```

第一次使用：

1. 在对话里输入 `/auth claude`，登录你要用的 agent。
2. 直接说你的需求。PM 会请架构师给出方案，你选定的方案即本项目的技术栈。

对话里输入 `/help` 查看全部命令。

项目里只保留过程记录：`team/`（对话记录、状态、任务卡、运行日志）和 `docs/`（需求、方案、决策、交付报告）、应用代码。团队公约与角色说明书随 CLI 发布，不复制进项目。

### 对话里的设置命令

| 命令 | 作用 |
| --- | --- |
| `/team` | 查看每个角色的 agent、模型、思考强度与认证状态 |
| `/agents` | 查看可用的 agent 及是否已认证 |
| `/auth <agent>` | 登录 agent（订阅，启动该 agent 自己的登录），或粘贴 API key（输入不显示） |
| `/assign <角色> <agent>` | 给角色换 agent。未认证会先登录，然后依次选择模型、思考强度 |
| `/assign all <agent>` | 全部角色换成同一个 agent，流程同上 |
| `/model <角色>` | 为角色重新选择模型与思考强度 |
| `/effort <角色>` | 只为角色重新选择思考强度 |
| `/help` | 显示说明 |
| `/退出` 或 `exit` | 结束对话 |

### 链式选择：认证 → 模型 → 思考强度

`/assign`、`/model` 都会按顺序弹出选择列表。在终端里可以用 ↑↓ 键移动、回车确认，也可以直接输入编号后回车；默认选第一项（agent 默认）。在 Git Bash 中界面改为行输入，只能输入编号；如需强制指定界面，设置环境变量 `AGENTTEAM_UI=tui`（完整界面）或 `AGENTTEAM_UI=plain`（行输入）：

```
/assign backend-dev codex
选择 Codex 的模型：
  1. agent 默认模型（推荐）
  2. gpt-5.1-codex-max
  3. gpt-6.1-sol
  4. 其他（手动输入模型名）
请输入编号（回车选 1）：2
选择 Codex 的思考强度：
  1. agent 默认（推荐）
  2. low
  3. medium
  4. high
  5. xhigh
  6. max
  7. ultra
请输入编号（回车选 1）：4
配置已保存。
```

- 选 "其他" 时可以手动输入模型名，只允许字母、数字与 `. _ : / -`。
- 中途输入结束（或在提示处直接关闭）视为取消，原配置不变。
- 选择结果写入项目的 `team/assignments.json`，只含 agent、模型与思考强度，不含任何凭证。

### 支持的模型与思考强度

| agent | 模型（编号列表中列出） | 思考强度 | 说明 |
| --- | --- | --- | --- |
| claude | claude-opus-5-5、claude-sonnet-5-5、claude-haiku-5-5、claude-fable-5-1 | low、medium、high、xhigh、max | 通过 `claude --effort` 传入 |
| codex | gpt-5.1-codex-max、gpt-6.1-sol | low、medium、high、xhigh、max、ultra | 通过 `-c model_reasoning_effort=<值>` 传入 |
| gemini | gemini-2.5-pro、gemini-3-pro-preview、gemini-3-flash-preview、gemini-3.1-pro-preview | 不支持按次设置 | Gemini CLI 只能在用户级设置里配置思考，本工具不改用户级设置，所以这一步会被跳过 |
| deepseek | deepseek-flash、deepseek-v4-pro | 关闭思考（off）、low、high、max | 通过 API 的 `thinking` 与 `reasoning_effort` 传入 |

每一项取值都来自对应的官方文档。编号列表里的 "agent 默认" 表示不传参数，使用 agent 自己的默认值。

### 对话的工作流程

直接说需求即可。对话的对象是 PM：

1. 说需求。团队分析需求（写出 `docs/requirements/REQ-NNN.md`），并与架构师沟通后列出一个或多个方案。
2. 选择方案：输入序号或字母（如 `2` 或 `B`），或用上下键移动后回车。
3. 不同意方案时直接写讨论意见，架构师会据此修改方案；讨论内容不会当作新需求。
4. 选定后，团队依次执行后端、前端、测试，最后写出交付报告 `docs/delivery/DELIVERY-NNN.md`。

需求进行中，只能选择方案、写讨论意见，或取消。取消的方法：按 Esc 或 Ctrl+C（输入框有字时先清空），或输入"取消"。执行中无法取消，等本步结束后再取消。取消或交付后，输入"新需求"或"new"，下一条输入才会作为新需求。失败的步骤回复"重试"或"继续"即可接着做，原需求保留。第一版暂不支持对已交付内容的直接调整（设计见 `docs/workflow.md`）。

每一句话和团队的回复都记在项目的 `team/conversation.md` 中；阶段保存在 `team/state.json`。

注意：对话会真实调用你分配给各角色的 agent，消耗对应的订阅额度或 API 费用。

### 凭证

- 订阅模式：`/auth` 启动该 agent 自己的登录，由 agent 自行保存登录状态。
- API 模式：在 `/auth` 里选择"粘贴 API key"，输入不显示。也可以用环境变量：`agentteam auth <agent> --from-env`。
- 凭证保存在 `~/.agentteam/credentials.json`（POSIX 系统上权限为 0600），不写入项目目录，不打印，不进入对话记录。

派发时订阅模式会清除 `ANTHROPIC_API_KEY` 等变量，避免 agent 静默改用 API 计费。

### 允许执行的命令

验证命令写在项目的 `team/allowed-commands.json`：

```json
{ "version": 1, "commands": ["npm test"] }
```

未列入的命令，agent 不能执行。Gemini 在无头模式下不能执行任何 shell 命令。

### 脚本与高级用法

日常只用 `agentteam` 即可。下面的子命令给脚本使用，不在 `--help` 中列出：

```bash
agentteam team                                      # 同对话里的 /team
agentteam agents                                    # 同对话里的 /agents
agentteam auth claude                               # 非交互环境下需加 --from-env 或 --confirm
agentteam assign backend-dev codex --model gpt-5 --effort high
agentteam assign qa --model claude-sonnet-5-5       # 只改模型
agentteam assign qa --effort low                    # 只改思考强度
agentteam assign --all codex                        # 全部角色
agentteam dispatch T-001 backend-dev                # 把 team/tasks/T-001.md 交给 backend-dev 执行
```

在非交互环境（管道、脚本）中，`assign` 直接写入配置，不弹出选择；未认证时会给出提示。

每次派发在 `team/runs/` 下写一份运行记录（提示词、回复、改动文件清单）。派发前会检查 agent 是否已接入、是否已认证，不满足时直接报错，不会启动 agent。

## 开放接口（为 Web / 移动端 / 小程序预留）

1. **JSON 事件输出**：部分命令加 `--json` 时，以 JSON 行输出事件，每行包含 `v`（schema 版本）、`type`、`time`。字段只增不减，变更时升级 `v`。
2. **模型调用抽象**：每个执行适配器（`src/adapters/`）实现同一个 `run()` 契约。新增 agent 只需加一个适配器文件。
3. **文件即状态**：协作状态保存在项目的 `team/`、`docs/` 目录，不依赖 CLI 的内存状态。任何界面都可以直接读取这些文件。

## 开发

```bash
npm install
npm test          # 先从仓库根目录同步 templates/，再运行测试
```

`templates/` 由 `scripts/sync-templates.js` 从仓库根目录的 `AGENTS.md`、手册、`prompts/` 生成，不要直接编辑，也不提交到仓库（见 `.gitignore`）。发布前 `prepack` 会自动同步。

### 本地测试（不发布到 npm）

开发阶段不需要发布。下面三种方式都只在本机生效。

**方式一：直接运行。** 改完代码立即生效，最简单。

```bash
cd cli
mkdir D:\测试项目
cd D:\测试项目
node <仓库>/cli/bin/agentteam.js                    # 进入对话
```

**方式二：`npm link`。** 像全局命令一样使用，代码改动无需重新链接。

```bash
cd cli
npm link                  # 在本机创建全局命令 agentteam，指向本目录
cd D:\测试项目
agentteam                 # 进入对话
npm unlink -g agentteam   # 用完后取消链接
```

**方式三：安装打包产物。** 最接近发布后的真实情况，用来检查 `files` 配置是否漏掉了文件。

```bash
cd cli
npm pack                                  # 生成 agentteam-<版本>.tgz，只在本地
npm install -g ./agentteam-<版本>.tgz     # 安装
npm uninstall -g agentteam                # 卸载
```

推荐流程：先 `npm test`；再在仓库外建一个临时测试项目，用方式一或二进入对话，依次试 `/auth`、`/assign`、`/effort`；发布前用方式三确认打包内容。

注意：对话与 `dispatch` 都会真正调用 agent 并消耗额度，测试时请用很小的任务。测试项目必须放在仓库外，避免 `team/`、`docs/` 混进 AgentTeam 仓库。

## 许可

MIT
