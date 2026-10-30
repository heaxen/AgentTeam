// 可供用户选择的 agent 注册表。
// 每个条目都已对照官方文档核对（见 source）。新增 agent 必须先核对再写入，
// 不得凭经验填写命令名或环境变量名。
// 字段说明：
//   command    安装后的可执行命令名（kind 为 api 时为空）
//   install    官方推荐的安装命令之一
//   login      订阅登录方式（在该 agent 自己的 CLI 里完成，AgentTeam 不保存凭证）
//   loginCommand 可直接由 AgentTeam 启动的登录命令（仅已核对为非交互入口的 agent 才有）
//   apiKeyEnv  个人 API key 对应的环境变量名
//   tokenEnv   可用于非交互认证的 token 环境变量名（如 GitHub token）
export const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    kind: 'cli',
    command: 'claude',
    install: 'curl -fsSL https://claude.ai/install.sh | bash（或 brew install --cask claude-code）',
    login: '运行 claude auth login，或在 claude 内输入 /login',
    loginCommand: 'claude auth login',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    verified: true,
    source: 'https://code.claude.com/docs/en/setup, https://code.claude.com/docs/en/authentication',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    kind: 'cli',
    command: 'codex',
    install: 'npm install -g @openai/codex',
    login: '运行 codex，选择 Sign in with ChatGPT',
    apiKeyEnv: [],
    verified: true,
    source: 'https://github.com/openai/codex（README）',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    kind: 'cli',
    command: 'gemini',
    install: 'npm install -g @google/gemini-cli',
    login: '首次运行 gemini，选择 Sign in with Google',
    apiKeyEnv: ['GEMINI_API_KEY'],
    verified: true,
    source: 'https://geminicli.com/docs/get-started/installation.md, https://geminicli.com/docs/get-started/authentication.md',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    kind: 'cli',
    command: 'qwen',
    install: 'npm install -g @qwen-code/qwen-code@latest（需要 Node.js 22+）',
    login: '首次运行 qwen 选择认证方式，之后可用 /auth 修改',
    apiKeyEnv: [],
    verified: true,
    source: 'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    kind: 'cli',
    command: 'copilot',
    install: 'npm install -g @github/copilot（需要 Node.js 22+）',
    login: '运行 copilot，未登录时输入 /login',
    apiKeyEnv: [],
    tokenEnv: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
    verified: true,
    source: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
  },
  {
    id: 'cursor',
    name: 'Cursor Agent CLI',
    kind: 'cli',
    command: 'agent',
    install: 'curl https://cursor.com/install -fsS | bash',
    login: '运行 agent login（浏览器登录），agent status 查看状态',
    loginCommand: 'agent login',
    apiKeyEnv: ['CURSOR_API_KEY'],
    verified: true,
    source: 'https://cursor.com/docs/cli/installation, https://cursor.com/docs/cli/reference/authentication',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    kind: 'cli',
    command: 'opencode',
    install: 'npm install -g opencode-ai',
    login: '运行 opencode auth login，按提示选择服务商',
    loginCommand: 'opencode auth login',
    apiKeyEnv: [],
    verified: true,
    source: 'https://opencode.ai/docs/ , https://opencode.ai/docs/cli/',
  },
  {
    id: 'aider',
    name: 'Aider',
    kind: 'cli',
    command: 'aider',
    install: 'pipx install aider-chat（或 python -m pip install aider-install）',
    login: '无内置订阅登录，通过 --api-key 或环境变量提供 key',
    apiKeyEnv: [],
    verified: true,
    source: 'https://aider.chat/docs/install.html',
  },
  {
    id: 'pi',
    name: 'Pi Coding Agent',
    kind: 'cli',
    command: 'pi',
    install: 'npm install -g @earendil-works/pi-coding-agent',
    login: '运行 pi 后输入 /login 选择服务商',
    apiKeyEnv: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY'],
    verified: true,
    source: 'https://pi.dev/docs/latest/providers',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API',
    kind: 'api',
    command: null,
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    verified: true,
    source: 'https://api-docs.deepseek.com/',
  },
];

export function listAgents() {
  return AGENTS;
}

export function getAgent(id) {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`未知 agent：${id}`);
  return agent;
}
