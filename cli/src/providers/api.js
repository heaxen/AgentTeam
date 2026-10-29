// API 模式：直接调用 Anthropic API，使用用户自己的 key，按 token 计费。
export const apiProvider = {
  name: 'api',

  async available(config) {
    return Boolean(config.apiKey);
  },

  async run({ prompt, model, apiKey }) {
    if (!apiKey) {
      throw new Error('API 模式需要 key：运行 `agentteam config set apiKey <你的key>`，或设置环境变量 ANTHROPIC_API_KEY');
    }
    // 按需加载，订阅模式的用户不需要初始化 SDK
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return { text, raw: message };
  },
};
