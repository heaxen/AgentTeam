# AgentTeam

把一群 AI Agent 组织成一支有分工、有门禁、有交付物的开发团队。

每个角色（需求与原型、架构师、前端开发、后端开发、测试）是一个独立的 AI 会话，只做自己的事。角色之间不直接对话，所有协作状态都落在仓库的文件里，由门禁逐条核对。

## 目录

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md` | 团队公约：角色边界、门禁、禁止事项（所有角色必读） |
| `AI开发团队角色与协作流程.md` | 团队手册：设计原理、角色卡片、流程与门禁 |
| `prompts/` | 各角色的开场说明（母版） |
| `stacks/_template.md` | 技术栈档案模板：每个项目填写一份，记录框架、目录、命令 |
| `docs/使用说明.md` | 落地步骤与日常操作 |
| `cli/` | 命令行工具 `agentteam`：在已有项目中初始化团队并调用模型 |

## 快速开始

```bash
cd cli
npm install
npm test
node bin/agentteam.js help
```

在你的项目中初始化团队：

```bash
node cli/bin/agentteam.js init /path/to/your-project
```

模型调用支持两种方式：订阅（本机 Claude Code）和个人 API key。详见 [`cli/README.md`](cli/README.md)。

## 当前状态

早期版本，见 [CHANGELOG.md](CHANGELOG.md)。任务派发与角色调度尚未实现。

## 许可

[MIT](LICENSE)
