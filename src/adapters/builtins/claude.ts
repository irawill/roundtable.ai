import { CliAdapter, type CliAdapterSpec } from './cli-adapter.js';

/**
 * Claude Code CLI adapter。
 *
 * 来自 §agent-adapter "内置 3 个 adapter" + tasks.md §5.1。
 *
 * **CLI flag 实测快照（2026-05-14）**——按 §agent-adapter "CLI flag 示例不构成长期契约"
 * + 跨阶段约束 #6，实测值非长期契约；用户改 models.yaml 即可覆盖：
 * - effort 通过 `--effort <level>` 取值 low | medium | high | xhigh | max
 * - output 用 `--output-format stream-json`（NDJSON，每行一个 JSON 对象）
 * - prompt 走 stdin（`claude -p ... < prompt`）
 *
 * argv 形态：`claude -p --verbose --output-format stream-json --effort <level>`，prompt 通过 stdin 传递。
 *
 * 注：Claude CLI 实测要求 `-p --output-format stream-json` 时必须配 `--verbose`，否则报错
 * "When using --print, --output-format=stream-json requires --verbose"（v2.1.142 实测）。
 *
 * Auth：`claude doctor` 主动检测（exit 0 = ok）。
 */
export function createClaudeAdapter(opts: { lastKnownVersion?: string | null } = {}) {
  const spec: CliAdapterSpec = {
    name: 'claude',
    command: 'claude',
    capabilities: ['web_search', 'code_understanding', 'code_execution', 'reasoning_effort'],
    roleSuitability: { enhancer: 'high', executor: 'high' },
    promptTransport: 'stdin',
    buildArgs: (effortFlags) => [
      '-p',
      '--verbose', // Claude CLI 要求：stream-json 输出格式必须配 --verbose
      '--output-format',
      'stream-json',
      ...effortFlags,
    ],
    outputMode: 'stream_json',
    effortMapping: {
      none: ['--effort', 'low'], // CLI 取值集合不含 'none'，none 退到最近 'low'
      low: ['--effort', 'low'],
      medium: ['--effort', 'medium'],
      high: ['--effort', 'high'],
      max: ['--effort', 'max'],
    },
    authCheckCommand: 'claude doctor',
    authCommandHint:
      '请在另一个终端运行：claude login（详见 https://docs.anthropic.com/en/docs/claude-code）',
    stderrExpiredPatterns: ['401', 'unauthorized', 'auth.*expired', 'invalid.*token'],
    usage: { mode: 'stream_json' },
    versionFlag: '--version',
    lastKnownVersion: opts.lastKnownVersion ?? null,
  };
  return new CliAdapter(spec);
}
