import { Command, Option } from 'commander';

/**
 * 全局 CLI flags（attach 到主命令与所有子命令）。
 *
 * 来自 §security-privacy + §language-support + §presenters + §command-alias
 * + tasks.md §20.1。
 *
 * Flags 解释：
 * - --scene <name>            scene override（详见 §question-enhancer）
 * - --lang <tag>              requested_output_language（详见 §language-support）
 * - --ui-lang <tag>           override resolved_ui_language
 * - --effort <spec>           "high" or "claude:max,codex:high"
 * - --enhancer <model>        临时换 enhancer
 * - --executor <model_or_mode> 临时指定 executor
 * - --no-tui                  关闭 TUI（中间进度走 stderr）
 * - --no-persist              全路径不落盘
 * - --no-adapters-mjs         跳过加载用户 adapters.mjs
 * - --verbose / --quiet       verbosity 三档（默认 normal）
 */

export interface GlobalOptions {
  scene?: string;
  lang?: string;
  uiLang?: string;
  effort?: string;
  enhancer?: string;
  executor?: string;
  tui: boolean;
  persist: boolean;
  adaptersMjs: boolean;
  verbose: boolean;
  quiet: boolean;
  /** --web-view <mode>：off / print_url_only / on（auto-open browser）；缺省走 prefs.ui.web_view */
  webView?: 'off' | 'print_url_only' | 'on';
}

/**
 * 把全局 options 附加到 commander Command。
 */
export function attachGlobalOptions(cmd: Command): Command {
  return cmd
    .option('--scene <name>', 'scene override (e.g., consumer / coding / research)')
    .option('--lang <tag>', 'output language: auto / system / BCP-47 / alias')
    .option('--ui-lang <tag>', 'UI language: system / match_output / BCP-47')
    .option(
      '--effort <spec>',
      'effort level: "high" or per-model "claude:max,codex:high"',
    )
    .option('--enhancer <model>', 'override enhancer model for this run')
    .option('--executor <spec>', 'override executor: <model> | rotate | random')
    .addOption(new Option('--no-tui', 'disable TUI; progress to stderr'))
    .addOption(new Option('--no-persist', "don't write runs/<uuid>/ to disk"))
    .addOption(
      new Option('--no-adapters-mjs', 'skip loading ~/.config/roundtable.ai/adapters.mjs'),
    )
    .option('--verbose', 'verbose output (TUI / stderr only)')
    .option('--quiet', 'quiet output (errors only)')
    .addOption(
      new Option('--web-view <mode>', 'web view: off | print_url_only | on (default: prefs.ui.web_view)').choices([
        'off',
        'print_url_only',
        'on',
      ]),
    );
}

/**
 * 解析 commander 收集的 options 为 strongly-typed 对象。
 *
 * commander v14 把 `--no-x` flags 解析为 `x: false`，本函数把它们转回 boolean 字段。
 */
export function parseGlobalOptions(raw: Record<string, unknown>): GlobalOptions {
  return {
    scene: typeof raw.scene === 'string' ? raw.scene : undefined,
    lang: typeof raw.lang === 'string' ? raw.lang : undefined,
    uiLang: typeof raw.uiLang === 'string' ? raw.uiLang : undefined,
    effort: typeof raw.effort === 'string' ? raw.effort : undefined,
    enhancer: typeof raw.enhancer === 'string' ? raw.enhancer : undefined,
    executor: typeof raw.executor === 'string' ? raw.executor : undefined,
    tui: raw.tui !== false, // 默认 true；--no-tui 时 false
    persist: raw.persist !== false,
    adaptersMjs: raw.adaptersMjs !== false,
    verbose: raw.verbose === true,
    quiet: raw.quiet === true,
    webView:
      raw.webView === 'off' || raw.webView === 'print_url_only' || raw.webView === 'on'
        ? raw.webView
        : undefined,
  };
}

/**
 * 决定 verbosity（quiet > verbose > normal）。
 */
export function resolveVerbosity(opts: GlobalOptions): 'quiet' | 'normal' | 'verbose' {
  if (opts.quiet) return 'quiet';
  if (opts.verbose) return 'verbose';
  return 'normal';
}
