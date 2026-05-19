import { CliAdapter, type CliAdapterSpec } from './cli-adapter.js';

/**
 * Gemini CLI adapter。
 *
 * 来自 §agent-adapter "内置 3 个 adapter" + tasks.md §5.3。
 *
 * **CLI flag 实测快照（2026-05-14）**：
 * - Gemini CLI 当前**无** reasoning-effort / thinking-budget flag
 * - effort 通过 `-m <model>` 切档实现：
 *   - none / low → gemini-2.5-flash
 *   - medium / high / max → gemini-2.5-pro
 * - prompt 走 stdin pipe（**不**用 `-p "<prompt>"` 把 prompt 放 argv，与 §security-privacy 默认 stdin 一致）
 * - usage 可能为 null（CLI 当前不保证暴露 usage_metadata）
 *
 * argv 形态：`gemini -m <model>`，prompt 通过 stdin。
 *
 * Auth：`gemini auth status` 主动检测。
 */
export function createGeminiAdapter(opts: { lastKnownVersion?: string | null } = {}) {
  const spec: CliAdapterSpec = {
    name: 'gemini',
    command: 'gemini',
    capabilities: ['web_search', 'reasoning_effort'],
    roleSuitability: { enhancer: 'medium', executor: 'high' },
    promptTransport: 'stdin',
    // gemini CLI 要求显式 `-p` 进入 non-interactive headless 模式（不传则进 TTY interactive）；
    // 传空字符串 `-p ""` 表示 prompt 走 stdin（与 promptTransport 一致）。
    // `-o json` 输出顶层为 `{ "response": "<agent JSON 字符串>", "stats": {...} }`，
    // 由 outputPureJsonField: 'response' 提取 + 二次解析 agent 真实 JSON。
    buildArgs: (effortFlags) => ['-p', '', '-o', 'json', ...effortFlags],
    outputMode: 'pure_json',
    outputPureJsonField: 'response',
    effortMapping: {
      none: ['-m', 'gemini-2.5-flash'],
      low: ['-m', 'gemini-2.5-flash'],
      medium: ['-m', 'gemini-2.5-pro'],
      high: ['-m', 'gemini-2.5-pro'],
      max: ['-m', 'gemini-2.5-pro'],
    },
    authCheckCommand: 'gemini auth status',
    authCommandHint:
      '请在另一个终端运行：gemini auth login（详见 https://github.com/google-gemini/gemini-cli）',
    stderrExpiredPatterns: ['401', 'unauthorized', 'auth.*expired', 'token.*invalid'],
    // gemini CLI 当前不暴露 usage；mode=none 静默返回 null，不影响流程
    usage: { mode: 'none' },
    versionFlag: '--version',
    lastKnownVersion: opts.lastKnownVersion ?? null,
  };
  return new CliAdapter(spec);
}
