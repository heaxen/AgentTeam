# 更改日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`主版本.次版本.修订号`。

- **主版本**：团队公约或角色边界发生不兼容变化（例如角色增删、门禁含义改变）。
- **次版本**：新增角色、门禁、CLI 命令等向后兼容的功能。
- **修订号**：文档修正、缺陷修复。

每个版本打一个 Git 标签 `vX.Y.Z`，与 `cli/package.json` 中的 `version` 保持一致。

## [未发布]

### 新增
- 对话入口：`agentteam` 进入对话（非交互环境只显示帮助；`agentteam chat` 同样进入对话）。第一版流程为需求分析、架构方案选择、按顺序执行（后端、前端、测试）、交付报告。
- 每个角色可单独指定 agent、模型与思考强度。对话中 `/assign <角色> <agent>` 与 `/assign all <agent>` 按顺序完成：认证（未认证时进入登录或粘贴 API key，输入不显示）→ 选择模型 → 选择思考强度 → 保存。`/model <角色>` 与 `/effort <角色>` 分别重新选择模型或强度。选择均为编号列表，回车选默认值，选"其他"可手动输入模型名。
- 思考强度支持的取值（来自官方文档）：claude（`--effort`：low、medium、high、xhigh、max）；codex（`-c model_reasoning_effort`：low、medium、high、xhigh、max、ultra）；deepseek（`thinking` 与 `reasoning_effort`：关闭、low、high、max）。gemini 不支持按次设置，链式选择时跳过该步。
- 角色配置格式升为 version 3：`team/assignments.json` 中每个角色为 `{ agent, model, effort }`。旧格式（纯字符串或只有 agent/model 的对象）读取时自动补全。
- 对话内命令：`/team`、`/agents`、`/auth <agent>`、`/assign`、`/model`、`/effort`、`/help`。`/auth` 不退出对话。
- 新增 `agentteam team`（当前阶段，以及每个角色的 agent、模型、思考强度与认证状态）。
- 对话流程的状态与对话记录分别写入 `team/state.json` 与 `team/conversation.md`。
- 派发前的检查失败（如未认证）不再结束对话，转为可重试的失败步骤。
- 测试：新增 `test/workflow.test.js`（主线、修改意见、方案选择、缺档案、失败重试、交付后分支）、`test/chat.test.js`（对话命令与链式选择）、`test/configure.test.js`（编号选择、各 agent 的链式流程、取消与 preset）、`test/effort.test.js`（各适配器的思考强度参数、角色强度读写）。

- 对话界面改为终端 TUI：底部固定为工作状态行（执行中显示转圈与秒数）、上下两条分隔线之间的输入行（平铺样式，无边框），以及两行状态栏（项目目录、分支、阶段，各 agent 的角色数）。对话记录在上方滚动，其他输出也进入记录区域。仅在真实终端中启用，管道与测试仍用行输入。仅使用 ANSI 转义，没有新增依赖。
- 修复 TUI 每次按键、团队执行时的刷新都会在下方叠加一份新界面的问题：每次绘制前先清掉上一帧。
- Git Bash（MSYS/mintty）下默认改用行输入（编号选择），因为其终端对光标重绘支持不可靠；Windows Terminal 与 PowerShell 仍用 TUI。可用环境变量 `AGENTTEAM_UI=tui` 或 `AGENTTEAM_UI=plain` 强制指定。
- 需求流程调整：输入需求后直接分析并列出方案（不再有需求确认步骤）；方案阶段输入序号、字母或上下键选择，其他文字是讨论意见，不会当作新需求。
- 取消：Esc 或 Ctrl+C（输入框有字时先清空），或输入"取消"；执行中无法取消。取消或交付后，输入"新需求"或"new"，下一条输入才作为新需求。失败后回复"重试"或"继续"从失败处接着做，原需求保留。
- 执行中的进度只显示角色名，不再打印执行细节。

### 变更
- 命令精简：`agentteam run`、`doctor`、`config` 已移除，改用对话与 `agentteam` 的脚本子命令。`team`、`agents`、`auth`、`assign`、`dispatch` 保留给脚本使用，不在 `--help` 中列出。
- 移除旧的全局模式配置（`~/.agentteam/config.json` 与 `src/providers/`），凭证统一保存在 `~/.agentteam/credentials.json`。

### 说明
- 未验证：对话流程尚未用真实 agent 端到端跑通；交互界面（编号列表、masked 输入、各 agent 的登录启动）只在非交互环境测试过；codex 的 `-c model_reasoning_effort`、claude 的 `--effort`、deepseek 的 thinking 参数均未实跑。
- 交付后的调整（A/B/C/D 类）推迟到下一版。

## [0.5.0] - 2026-10-30

### 新增
- 执行适配层（设计见 `cli/docs/adapters.md`）：claude、codex、gemini 的无头调用，统一为同一个 `run()` 契约。
- CLI `dispatch <任务号> <角色>`：读取任务卡与角色说明书，交给该角色分配的 agent 执行，写入 `team/runs/` 运行记录，并列出本次改动的文件。
- 凭证按 agent 记录认证方式（`subscription` 或 `api`）。派发时订阅模式会清除 `ANTHROPIC_API_KEY` 等变量，避免静默改用 API 计费。
- DeepSeek 适配器：工具循环（读、写、列目录、运行白名单命令），文件访问限定在项目根目录内。
- 命令白名单 `team/allowed-commands.json`：claude 通过 `--allowedTools` 放行；DeepSeek 通过 `run_command` 工具放行。
- `init` 新建 `team/runs/` 目录。

### 说明
- 已实跑：claude 订阅模式（写文件；白名单内命令执行、白名单外命令被拒绝）。codex、gemini、deepseek 尚未实跑。
- Gemini 无头模式下 shell 命令一律拒绝，不写白名单（其策略文件在用户级目录，会影响所有项目）。
- `run`、`doctor` 仍使用旧的全局 `mode` 配置，与按 agent 的认证方式并存，后续需要统一。

## [0.4.0] - 2026-10-30

### 新增
- CLI `agents`：列出 10 个已对照官方文档核对的 agent（claude、codex、gemini、qwen、copilot、cursor、opencode、aider、pi、deepseek）及认证状态。
- CLI `auth <agent>`：启动该 agent 自己的登录；`--from-env` 从环境变量保存 API key；`--confirm` 在手动登录后记录为已认证。
- CLI `assign`：按角色指定 agent（`assign <角色> <agent>`、`assign --all <agent>`），记录在项目的 `team/assignments.json`，不含凭证。
- 凭证单独保存在 `~/.agentteam/credentials.json`，与 `config.json` 分离。

### 说明
- 角色执行层还只支持 Claude；其他 agent 的调用适配器尚未实现。

## [0.3.0] - 2026-10-29

> 说明：原计划的 0.2.0（跨角色消息 MSG、联调与缺陷闭环、CLI `init` 新建 `docs/messages/`）未单独发版，其内容已并入本版本。历史中没有 v0.2.0 标签。

### 新增
- 交付报告 `docs/delivery/DELIVERY-NNN.md`（团队公约第 13 节）：面向真实用户的唯一对外产物，通过 G5 后由 PM 编写。
- 过程记录留痕规则：讨论、裁决、验收、缺陷必须落盘，并在交付报告附录可追溯。
- CLI `init` 新建 `docs/delivery/` 目录。

### 变更
- PM 说明书的"回报用户"改为交付报告结构，内部回报格式保留。

## [0.2.0] - 2026-10-29

### 新增
- 跨角色消息 `docs/messages/MSG-NNN.md`（团队公约第 12 节）：角色之间只经文件与 PM 沟通，明确类型、状态与关闭规则。
- 联调（JOINT）与缺陷闭环流程：BUG 单写归属层，PM 开修复任务卡，同一 BUG 回归超过 3 轮由 PM 写 ADR。
- CLI `init` 新建 `docs/messages/` 目录。

### 变更
- 各角色开场说明的"跨角色协作禁令"改为引用 MSG 流程。
- 手册的返工回路与会话隔离规则同步更新。

## [0.1.0] - 2026-10-29

### 新增
- 团队公约 `AGENTS.md` 与手册 `AI开发团队角色与协作流程.md`。
- 角色开场说明：项目经理、需求分析、架构师（草稿）、原型设计、UI 开发、前端开发、后端开发、测试。
- 技术栈档案模板 `stacks/_template.md`。
- CLI `agentteam`：`init`、`config`、`doctor`、`run`，支持订阅与 API 两种模式，`--json` 事件输出。
- G1.5 架构确认门禁（草案）。
