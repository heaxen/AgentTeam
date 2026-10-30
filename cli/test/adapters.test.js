import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommand as claudeCommand, buildEnv as claudeEnv } from '../src/adapters/claude.js';
import { buildCommand as codexCommand } from '../src/adapters/codex.js';
import { buildCommand as geminiCommand, buildEnv as geminiEnv } from '../src/adapters/gemini.js';
import { runProcess, assertSafeToken, quotePath, toRunResult } from '../src/adapters/process.js';
import { getAdapter, hasAdapter } from '../src/adapters/index.js';

test('claude 无头命令：使用 -p、JSON 输出和 acceptEdits，提示词不进命令行', () => {
  assert.equal(claudeCommand(), 'claude -p --output-format json --permission-mode acceptEdits');
  assert.equal(
    claudeCommand({ model: 'claude-sonnet-5-5' }),
    'claude -p --output-format json --permission-mode acceptEdits --model claude-sonnet-5-5',
  );
});

test('claude 订阅模式：删除 ANTHROPIC_API_KEY，避免 -p 静默改用 API 计费', () => {
  const base = { ANTHROPIC_API_KEY: 'sk-env', ANTHROPIC_AUTH_TOKEN: 'tok', PATH: '/bin' };
  const env = claudeEnv({ method: 'subscription' }, base);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.PATH, '/bin');
  assert.equal(base.ANTHROPIC_API_KEY, 'sk-env', '不应修改传入的环境对象');
});

test('claude 个人 API 模式：注入本机保存的 key，忽略环境里的旧值', () => {
  const env = claudeEnv({ method: 'api', apiKey: 'sk-saved' }, { ANTHROPIC_API_KEY: 'sk-old' });
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-saved');
  assert.throws(() => claudeEnv({ method: 'api' }, {}), /缺少 key/);
});

test('codex 无头命令：工作区可写、stdin 读提示词、输出写入指定文件', () => {
  const command = codexCommand({ outputFile: 'C:\\tmp\\out.txt' });
  assert.equal(
    command,
    'codex exec --skip-git-repo-check -s workspace-write -o "C:\\tmp\\out.txt" -',
  );
  assert.match(codexCommand({ model: 'gpt-5', outputFile: '/tmp/o' }), / -m gpt-5 -$/);
});

test('gemini 无头命令与环境变量：订阅模式清除两个 key 变量，API 模式只注入 GEMINI_API_KEY', () => {
  assert.equal(
    geminiCommand(),
    'gemini -p "Follow the instructions on stdin" -o json --approval-mode auto_edit',
  );
  const sub = geminiEnv({ method: 'subscription' }, { GEMINI_API_KEY: 'a', GOOGLE_API_KEY: 'b' });
  assert.equal(sub.GEMINI_API_KEY, undefined);
  assert.equal(sub.GOOGLE_API_KEY, undefined);
  const api = geminiEnv({ method: 'api', apiKey: 'k' }, {});
  assert.equal(api.GEMINI_API_KEY, 'k');
});

test('白名单校验：模型名与路径中出现空格或 shell 元字符时拒绝', () => {
  assert.throws(() => assertSafeToken('a b', 'model'), /非法字符/);
  assert.throws(() => assertSafeToken('x;rm', 'model'), /非法字符/);
  assert.throws(() => quotePath('C:\\a"b', '输出文件'), /非法字符/);
  assert.equal(quotePath('C:\\Users\\x\\o.txt', '输出文件'), '"C:\\Users\\x\\o.txt"');
});

test('适配器登记：claude、codex、gemini 可执行；其余 agent 明确报未接入', () => {
  assert.equal(hasAdapter('claude'), true);
  assert.equal(getAdapter('codex').id, 'codex');
  assert.throws(() => getAdapter('aider'), /尚未接入执行适配器/);
  assert.throws(() => getAdapter('constructor'), /尚未接入执行适配器/);
});

test('runProcess：收集 stdout、传入 stdin、以退出码结束', async () => {
  const proc = await runProcess({
    command: 'node -e "process.stdin.pipe(process.stdout)"',
    input: 'hello 你好',
    timeoutMs: 10_000,
  });
  assert.equal(proc.code, 0);
  assert.equal(proc.stdout, 'hello 你好');
});

test('runProcess：非零退出码如实返回，toRunResult 标记为失败', async () => {
  const proc = await runProcess({ command: 'node -e "process.exit(3)"', input: '', timeoutMs: 10_000 });
  const result = toRunResult(proc, 'x', undefined);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.text, '');
  assert.match(result.error, /退出码 3/);
});

test('runProcess：超时后终止并标记 timedOut', async () => {
  const proc = await runProcess({
    command: 'node -e "setTimeout(() => {}, 60000)"',
    input: '',
    timeoutMs: 300,
  });
  assert.equal(proc.timedOut, true);
  const result = toRunResult(proc, '', undefined);
  assert.equal(result.ok, false);
  assert.match(result.error, /超时/);
});
