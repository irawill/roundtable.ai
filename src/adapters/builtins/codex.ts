import { CliAdapter, type CliAdapterSpec } from './cli-adapter.js';

/**
 * Codex / GPT-5 CLI adapter。
 *
 * 来自 §agent-adapter "内置 3 个 adapter" + tasks.md §5.2。
 *
 * **CLI flag 实测快照（2026-05-14）**：
 * - Codex CLI 无独立 `--reasoning-effort` flag；reasoning 通过 `-c <key>=<val>` config 控制
 *   （具体 key 为 `model_reasoning_effort`）
 * - prompt 走 stdin pipe（`codex exec ...`），argv 末尾**不**追加 prompt 字符串或 `-` sentinel
 * - output 走 `--json` 输出 JSON
 *
 * argv 形态：`codex exec -c model_reasoning_effort=<level> --json`，prompt 通过 stdin。
 *
 * Auth：**双轨**（来自 §agent-adapter "Auth 状态检测" 双轨条款）：
 * - check_env: OPENAI_API_KEY（fast path 命中视为 ok）
 * - check_command: codex login status（env 未设回退跑，覆盖 ChatGPT account 模式）
 */
export function createCodexAdapter(opts: { lastKnownVersion?: string | null } = {}) {
  const spec: CliAdapterSpec = {
    name: 'codex',
    command: 'codex',
    capabilities: ['web_search', 'code_understanding', 'reasoning_effort'],
    roleSuitability: { enhancer: 'high', executor: 'high' },
    promptTransport: 'stdin',
    // Codex 用 `codex exec --json -` 从 stdin 读 prompt（不加 - 时会等 TTY）
    // --skip-git-repo-check：rtai 跨目录调用，cwd 可能不是 git 仓库；codex 默认拒绝运行非
    // trusted 目录，加此 flag 显式跳过（rtai 只把 codex 当 LLM API 用，不读写工作区文件）
    buildArgs: (effortFlags) => ['exec', '--skip-git-repo-check', ...effortFlags, '--json', '-'],
    // Codex CLI 输出 NDJSON（type=thread.started / turn.started / item.completed / turn.completed），
    // 用 stream_json extractor 取 `item.completed.item.text`（含 agent 返回的 JSON 字符串）。
    outputMode: 'stream_json',
    effortMapping: {
      none: ['-c', 'model_reasoning_effort=minimal'],
      low: ['-c', 'model_reasoning_effort=low'],
      medium: ['-c', 'model_reasoning_effort=medium'],
      high: ['-c', 'model_reasoning_effort=high'],
      max: ['-c', 'model_reasoning_effort=high'],
    },
    authCheckEnv: 'OPENAI_API_KEY',
    authCheckCommand: 'codex login status',
    authCommandHint:
      '请在另一个终端运行：codex login（或 export OPENAI_API_KEY=sk-...），完成后回车继续',
    stderrExpiredPatterns: ['401', 'unauthorized', 'api.*key.*invalid', 'auth.*expired'],
    // Codex stream_json 末尾的 turn.completed 含 usage 对象；usage extractor 从 streamUsage 取
    usage: { mode: 'stream_json' },
    versionFlag: '--version',
    lastKnownVersion: opts.lastKnownVersion ?? null,
  };
  return new CliAdapter(spec);
}
