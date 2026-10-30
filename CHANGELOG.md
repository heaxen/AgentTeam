# 更改日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`主版本.次版本.修订号`。

- **主版本**：团队公约或角色边界发生不兼容变化（例如角色增删、门禁含义改变）。
- **次版本**：新增角色、门禁、CLI 命令等向后兼容的功能。
- **修订号**：文档修正、缺陷修复。

每个版本打一个 Git 标签 `vX.Y.Z`，与 `cli/package.json` 中的 `version` 保持一致。

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
