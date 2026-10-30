# 执行适配层设计

> 状态：已随 CLI 0.5.0 发布（2026-10-30）。未标注"已实现"的条目为计划内容。

## 一、要解决的问题

真实用户的意图（来自需求对话，已确认）：

1. 在**已有项目**里安装 `agentteam`，把一句需求交给团队，团队按角色干活，最后交付可用结果。
2. 用户可以把**任意已支持的 agent** 分配给**任意角色**（如 Claude 做后端、Codex 做前端、DeepSeek 做测试，或全部交给 Claude）。
3. 每个 agent 只认证一次：订阅走该 agent 自己的登录，或使用个人 API key。认证过了就不再询问。
4. 讨论、裁决、验收、缺陷全部落盘留痕；对外只交付一份用户报告。

0.4.0 已经有了注册表、认证、角色分配，但**缺少真正执行角色的那一层**：`assign` 只写文件，没有任何东西读取它；`run` 只是一次性问答，不能读写项目文件。本设计补上这一层。

## 二、适配器契约

每个 agent 的执行入口统一为一个适配器，位于 `cli/src/adapters/`，对上层只暴露：

```
adapter.id              与 agents.js 中的 id 相同
adapter.canEditFiles    true 表示 agent 自己能读写项目文件（执行角色任务的前提）
adapter.run({
  prompt,               完整的角色指令（由 dispatch 组装）
  cwd,                  项目根目录，agent 的工作目录
  model,                可选，白名单校验后使用
  credential,           { method: 'subscription' | 'api', apiKey? }，来自 credentials.json
  timeoutMs,            超时，默认 30 分钟
}) → {
  ok,                   退出码为 0、未超时、结果未报错时为 true
  text,                 agent 最终回复的正文
  exitCode,
  timedOut,
  error,                失败原因（给人看的中文）
  stderr,               仅用于排错，不进入交付物
}
```

上层只依赖这个契约。新增 agent = 新增一个文件 + 一个测试，不改 dispatch。

### 不做的事

- 适配器不决定角色做什么，不改任务卡，不判断门禁。
- 适配器不保存凭证；凭证只从 `~/.agentteam/credentials.json` 读取，按需注入子进程环境变量。
- 适配器不把用户内容拼进命令行。提示词一律经 stdin 传入（避免长度限制与 shell 转义问题）。命令行只含固定字符串与白名单参数。

## 三、各 agent 的无头调用

"核对"列写明依据。没有核对过的 agent 不得写适配器。

| agent | 无头命令 | 认证方式 | 能否改文件 | 核对依据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| claude | `claude -p --output-format json --permission-mode acceptEdits [--model M]`，提示词走 stdin | 订阅：`claude auth login`；个人 API：环境变量 `ANTHROPIC_API_KEY` | 能 | 本机 `claude --help`（2.1.312）；官方认证文档 | **已实现，已实跑**（订阅模式，见 §十） |
| codex | `codex exec --skip-git-repo-check -s workspace-write -o <临时文件> [-m M] -`，`-` 表示从 stdin 读提示词 | 订阅：`codex` 内 Sign in with ChatGPT | 能 | 本机 `codex exec --help`（0.165.0） | **已实现，未实跑**（本机未登录，见 §十） |
| gemini | `gemini -p "Follow the instructions on stdin" -o json --approval-mode auto_edit [-m M]`，完整提示词走 stdin | 订阅：Google 登录；个人 API：`GEMINI_API_KEY` | 能（仅编辑，见 §五） | Gemini 官方 headless 与 CLI 参考文档 | **已实现，未实跑**（本机未安装，见 §十） |
| deepseek | HTTP `POST https://api.deepseek.com/chat/completions`，OpenAI 兼容的 `tools` / `tool_calls`；模型固定为 `deepseek-v4-pro` | 个人 API：`DEEPSEEK_API_KEY` | 能，经由本进程提供的四个工具（见 §五） | DeepSeek 官方 API 与工具调用文档 | **已实现（工具循环），未实跑**：没有 DeepSeek key，无法实跑 |
| qwen | 待核对 | — | — | — | 未接入 |
| copilot | 待核对（`copilot -p` 需 token 认证，见注册表 tokenEnv） | — | — | — | 未接入 |
| cursor | 待核对（`agent -p`） | — | — | — | 未接入 |
| opencode | 待核对（`opencode run`） | — | — | — | 未接入 |
| aider | 待核对（`aider --message`） | — | — | — | 未接入 |
| pi | 待核对 | — | — | — | 未接入 |

注：`aider`、`pi` 等的无头参数在 0.5.0 之后逐个核对、逐个接入，不在本次范围内。

## 四、认证与环境变量

### 4.1 为什么要改子进程环境

Claude Code 官方认证文档写明：`-p` 模式下只要环境变量里有 `ANTHROPIC_API_KEY`，就一定使用它，并且优先于订阅登录。因此：

- **订阅模式**：子进程环境里必须**删除** `ANTHROPIC_API_KEY`，否则用户以为在用订阅，实际在按 token 计费。
- **个人 API 模式**：子进程环境里设置 `ANTHROPIC_API_KEY` 为本机保存的 key。

Gemini 官方文档同样说明 `GEMINI_API_KEY`、`GOOGLE_API_KEY` 会被优先使用。订阅模式同样删除这两个变量。

### 4.2 每个 agent 的认证方式记在哪里

认证方式属于**每个 agent 的凭证**，记在 `~/.agentteam/credentials.json`：

```json
{ "agents": { "claude": { "method": "subscription", "loggedInAt": "..." },
              "gemini": { "method": "api", "apiKey": "...", "savedAt": "..." } } }
```

- `auth <agent>`（登录）写入 `method: subscription`。
- `auth <agent> --from-env`（保存 key）写入 `method: api`。
- 全局的 `config.mode` 只服务于 `run` 命令，**不影响角色执行**。这样才能满足"同一个团队里，有的角色走订阅，有的走 API"。

### 4.3 凭证检查

派发任务前，dispatch 先检查：适配器存在 → agent 命令可执行（`--version`） → 凭证满足所选 method。任一不满足，直接报错并给出下一步命令，不启动 agent。

## 五、权限与写入范围

无头模式下 agent 不能弹窗确认，因此权限要在启动前定好。

| agent | 当前选择 | 含义 | 已知缺口 |
| --- | --- | --- | --- |
| claude | `acceptEdits` + `--allowedTools` | 自动通过文件编辑；只放行 `team/allowed-commands.json` 中的命令 | 白名单之外的 shell 命令无头下会被拒绝（已实跑验证） |
| codex | `workspace-write` | 允许在工作区内写文件与执行命令 | 工作区之外的写入会被沙箱拦下。白名单未接入（待核对 codex exec 的批准策略） |
| gemini | `auto_edit` | 自动通过文件编辑 | **shell 命令在无头模式下一律拒绝**。Gemini 的白名单只能写在用户级 `~/.gemini/policies/`，会影响它在所有项目中的行为，因此不写。需要跑命令的角色暂时用 claude 或 deepseek |
| deepseek | 本进程的四个工具 | `read_file`、`write_file`、`list_dir` 只能访问项目根目录内的路径，`.git` 不可访问；`run_command` 只能执行白名单中整条一致的命令 | 每步最多 60 次工具循环，总时长受 `timeoutMs` 限制 |

### 白名单文件

`team/allowed-commands.json`，由用户或 PM 维护，不存在时视为没有允许的命令：

```json
{ "version": 1, "commands": ["npm test", "npm run build"] }
```

- 每条只允许字母、数字、空格和 `. _ / : -`，不允许引号、分号、管道等元字符。
- 命令必须整条一致才放行，不接受额外参数（claude 的 `--allowedTools` 例外，见下）。
- claude 会为每条命令生成两种模式：`Bash(命令)` 与 `Bash(命令 *)`，即带参数也放行。这是 claude 的写法，已由实跑验证。

**写入范围**（角色只能写自己的目录）目前只靠提示词约束。0.5.0 在派发前后各记一次文件清单，把本次改动的文件列在运行日志和命令输出里，由 PM 判断是否越界。CLI **不自动判断越界、不回滚**：判断依据是档案里的目录约定，这部分属于后续工作。

## 六、运行留痕

每次派发写一份运行日志：`team/runs/<任务号>-<角色>-<时间戳>.md`，包含：

- 任务号、角色、agent、认证方式（只写方式名，不写 key）、起止时间、退出码、是否超时；
- 实际发送的提示词全文；
- agent 的回复原文；
- 派发前后的文件清单差异（越界检查的依据）。

`team/runs/` 属于 PM 管理的过程记录，对应公约第 13.1 节。它不进入交付报告正文。

## 七、决策记录

用户已确认按推荐方案执行：

1. **纯 API agent（DeepSeek）执行角色**：采用方案 A，工具循环（§五）。
2. **shell 命令权限**：采用白名单 `team/allowed-commands.json`（§五）。Gemini 例外，不写用户级策略文件。

仍待定：

3. **运行超时**：默认 30 分钟；`--timeout-min` 尚未实现。
4. **`run` 与 `doctor`**：仍使用旧的全局 `mode` 配置。推荐之后下线，统一到 `agents`、`auth`、`dispatch`；未定下线时间。
5. **Codex 的白名单**：待核对 `codex exec` 在非交互下的批准策略。

## 八、分阶段

| 阶段 | 内容 | 版本 |
| --- | --- | --- |
| 1 | 适配器契约、claude / codex / gemini 适配器、凭证的按 agent 认证方式、`dispatch <任务号> <角色>`、运行日志、改动清单（只报告，不判越界） | 0.5.0 |
| 2 | DeepSeek 工具循环；命令白名单（claude 已接入，codex 待核对） | 0.5.0 |
| 3 | 门禁自动核对（G1–G5 的文件检查） | 之后 |
| 4 | 其余 agent（qwen、copilot、cursor、opencode、aider、pi）逐个核对后接入 | 之后 |

## 九、测试策略

- 命令拼接、环境变量注入、输出解析：纯函数，单元测试覆盖，包括"订阅模式下 `ANTHROPIC_API_KEY` 被删除"。
- 子进程执行：用本机 Node 脚本代替真实 agent，覆盖 stdin 传入、非零退出、超时（超时会结束整个进程树）。
- 派发前校验：用临时目录和临时凭证文件，确认任务卡缺失、agent 未接入、未认证时都在启动 agent 之前报错。测试不读取用户真实的凭证。

## 十、实跑记录

| 日期 | 范围 | 结果 |
| --- | --- | --- |
| 2026-10-30 | claude，订阅模式，临时项目，任务卡要求创建 `smoke.txt` | 通过：agent 写入文件，改动清单只列出 `smoke.txt`，运行记录写入 `team/runs/` |
| 2026-10-30 | claude，白名单，临时项目，任务要求运行 `node --version` 与一条未允许的 `echo blocked` | 通过：允许的命令执行成功；未允许的命令被拒绝，agent 没有绕过 |
| 2026-10-30 | claude，派发时的"已读文件"要求 | 发现问题：agent 自述跳过了手册。已在提示词中要求逐条列出实际读过的文件，尚未复测 |
| 2026-10-30 | codex | 未实跑：本机 `codex login status` 显示未登录。需要用户先完成登录 |
| 2026-10-30 | gemini | 未实跑：本机未安装 |
| 2026-10-30 | deepseek | 未实跑：没有 DeepSeek key。工具循环已由脚本化的假 HTTP 响应测试覆盖 |

实跑时在用户机器上写入了 `~/.agentteam/credentials.json`（claude，method: subscription），这是 `auth claude --confirm` 的结果。该文件保留，等待用户确认是否保留。
