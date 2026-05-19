// Note: shebang `#!/usr/bin/env node` is injected by tsup banner; don't add it here.
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { attachGlobalOptions, parseGlobalOptions, resolveVerbosity } from './options.js';
import { handleTopLevelError, CliError, ExitCode } from './errors.js';
import { runNpmUpgrade, startBackgroundUpgradeCheck } from './upgrade.js';
import { buildConfigCommand } from './config-commands.js';
import { buildFollowupCommand } from './followup-command.js';
import {
  buildExportCommand,
  buildHistoryCommand,
  buildResumeCommand,
  buildShowCommand,
} from './history-commands.js';
import { resolveConfigPaths } from '../config/paths.js';
import { runWizard, type WizardPromptFn } from '../wizard/index.js';
import { routeQuestion, type LoadedConfigs } from './route.js';
import { runOrchestrator, type PersistenceCallbacks } from '../orchestrator/run.js';
import { createBuiltinAdapters } from '../adapters/builtins/index.js';
import { deriveSystemLanguage } from '../shared/lang/system-language.js';
import { parseRequestedOutputLanguage } from '../lang/resolver.js';
import { resolveProvisionalUi } from '../lang/ui-resolver.js';
import { parseCliEffort, type CliEffort } from '../config/effort.js';
import { RunsIo } from '../persistence/runs.js';
import { buildRedactor } from '../persistence/meta.js';
import { startStdoutPresenter } from '../presenters/stdout.js';
import { EventEmitter } from '../shared/event-emitter.js';
import type { Event } from '../shared/event-types.js';
import type { LanguageState, RequestedOutputLanguage } from '../lang/types.js';
import type { GlobalOptions } from './options.js';
import type { ModelConfig } from '../config/schemas/models.js';
import { pruneHistory } from '../persistence/history.js';
import type { Adapter } from '../shared/adapter.js';

/**
 * CLI 主入口（rtai 命令）。
 *
 * 来自 tasks.md §20.1 §20.2 §20.5 + 各阶段装配。
 *
 * 命令结构：
 *   rtai [global flags] "<question>"           # 主流程
 *   rtai setup                                  # 重跑 wizard
 *   rtai config <subcommand>                    # config 子命令套
 *   rtai history [filters]                      # history 列表
 *   rtai history forget|clear                   # 删除 run
 *   rtai show <uuid> [--rounds]                 # 详情
 *   rtai resume <uuid>                          # 恢复
 *   rtai export <uuid> --format=md              # 导出
 *   rtai upgrade                                # npm install -g 升级
 */

const PACKAGE_VERSION = '0.1.0';

async function main(argv: readonly string[]): Promise<number> {
  const root = new Command('rtai')
    .version(PACKAGE_VERSION)
    .description('Roundtable.ai — multi-AI roundtable on the command line')
    .argument('[question]', 'your question (omit to use a subcommand)');
  attachGlobalOptions(root);

  const paths = resolveConfigPaths();

  // 子命令
  root.addCommand(
    new Command('setup').description('rerun the setup wizard').action(async () => {
      await runInteractiveWizard();
    }),
  );

  root.addCommand(buildConfigCommand({ paths }));
  root.addCommand(buildHistoryCommand({ paths }));
  root.addCommand(buildShowCommand({ paths }));
  root.addCommand(buildResumeCommand({ paths }));
  root.addCommand(buildExportCommand({ paths }));
  root.addCommand(
    buildFollowupCommand({
      paths,
      loadConfigs: async () => {
        const { loadAllConfigs } = await import('./route.js');
        return loadAllConfigs(paths);
      },
      runMainQuestion,
    }),
  );
  root.addCommand(
    new Command('upgrade')
      .description('upgrade roundtable.ai via npm')
      .action(async () => {
        const code = await runNpmUpgrade({});
        if (code !== 0) {
          throw new CliError(`npm install exited with code ${code}`, ExitCode.RuntimeError);
        }
      }),
  );

  // 主入口 action（位置参数 question）
  root.action(async (question: string | undefined, rawOpts: Record<string, unknown>) => {
    const opts = parseGlobalOptions(rawOpts);
    const verbosity = resolveVerbosity(opts);

    // 启动 registry check（fire-and-forget）
    const registryCheckPromise = startBackgroundUpgradeCheck({
      upgradeCheck: 'on',
      currentVersion: PACKAGE_VERSION,
    });

    // 路由决策
    const decision = routeQuestion({ question, globalOptions: opts, paths });

    if (decision.kind === 'wizard_first_run') {
      await runInteractiveWizard();
      if (question === undefined || question === '') {
        process.stderr.write('✓ wizard 完成，下次运行 `rtai "你的问题"` 即可\n');
        return;
      }
      process.stderr.write(`✓ wizard 完成，继续原始问题：「${question}」\n`);
      const newDecision = routeQuestion({ question, globalOptions: opts, paths });
      announceDecision(newDecision, verbosity);
      return;
    }

    if (decision.kind === 'abort_empty') {
      throw new CliError(decision.reason, ExitCode.ConfigError);
    }

    announceDecision(decision, verbosity);

    // 端到端 runOrchestrator 装配
    if (question === undefined || question.trim() === '') {
      throw new CliError(
        'missing question; usage: rtai "<your question>" or use a subcommand (rtai --help)',
        ExitCode.UsageError,
      );
    }

    const configs =
      decision.kind === 'single_agent_direct' || decision.kind === 'enhance_then_layer2'
        ? decision.configs
        : null;
    if (configs === null) {
      throw new CliError('routing returned unexpected kind', ExitCode.RuntimeError);
    }

    // 启动时 prune（history retain）
    try {
      pruneHistory({
        runsIo: new RunsIo(paths),
        runsDir: paths.runsDir,
        policy: configs.prefs.history.retain_runs,
      });
    } catch {
      // ignore prune errors
    }

    const exitCode = await runMainQuestion({
      question,
      opts,
      configs,
      paths,
    });

    const upgradeMsg = await registryCheckPromise;
    if (upgradeMsg !== null) process.stderr.write(upgradeMsg + '\n');

    if (exitCode !== 0) process.exit(exitCode);
  });

  try {
    await root.parseAsync(['node', 'rtai', ...argv]);
    return ExitCode.Success;
  } catch (err) {
    if (err instanceof Error && err.name === 'CommanderError') {
      return ExitCode.UsageError;
    }
    throw err;
  }
}

async function runInteractiveWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const promptFn: WizardPromptFn = {
    ask: async (p) => (await rl.question(p)).trim(),
    confirm: async (p) => {
      const ans = (await rl.question(p)).trim().toLowerCase();
      return ans === '' || ans === 'y' || ans === 'yes';
    },
    choose: async (p, options) => {
      process.stdout.write(p + '\n');
      for (let i = 0; i < options.length; i++) {
        process.stdout.write(`  [${i + 1}] ${options[i]}\n`);
      }
      while (true) {
        const ans = (await rl.question('> ')).trim();
        const n = Number(ans);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
        process.stdout.write('  invalid, try again\n');
      }
    },
  };
  try {
    await runWizard({ paths: resolveConfigPaths(), prompt: promptFn });
  } finally {
    rl.close();
  }
}

/**
 * 端到端跑一次问题：装配 adapters / language / effort / persistence / stdout presenter → 调 runOrchestrator。
 *
 * 支持追问（来自 §followup-rounds）：传 `followupContext` 时 enhancer 走追问 prompt + 自动 confirm + 写 parent_run_id / followup_depth。
 */
async function runMainQuestion(args: {
  question: string;
  opts: GlobalOptions;
  configs: LoadedConfigs;
  paths: ReturnType<typeof resolveConfigPaths>;
  /** 追问上下文（可选）；非空时跳过用户确认页 + 写 parent_run_id 链路 */
  followupContext?: import('../orchestrator/run.js').FollowupContext;
}): Promise<number> {
  const { question, opts, configs, paths, followupContext } = args;

  // ─── adapters：内置 + JS adapters.mjs（用户自加 ESM） ───
  const builtins = createBuiltinAdapters();
  const adapters = new Map<string, Adapter>();
  for (const [name, adapter] of Object.entries(builtins)) adapters.set(name, adapter);

  // adapters.mjs 加载（来自 §security-privacy "自定义 adapter 信任模型"）：
  // - --no-adapters-mjs：跳过
  // - 文件不存在：静默跳过
  // - 首次或 mtime 变化：交互式 stderr 提示 + readline 询问；非 TTY 默认拒绝
  // - 信任已确认：dynamic import → 合并 adapters map（同名让位 builtin + warn）
  if (opts.adaptersMjs !== false) {
    const { loadJsAdapters } = await import('../adapters/js-loader.js');
    const jsResult = await loadJsAdapters({
      path: paths.adaptersMjs,
      skip: false,
      currentTrustedMtime: configs.prefs.security.adapters_mjs_trusted_mtime,
      confirmTrust: async (reason) => {
        if (!process.stdin.isTTY) return false;
        const msg =
          reason === 'first_load'
            ? `检测到 ${paths.adaptersMjs}。`
            : `${paths.adaptersMjs} 已修改（mtime 变化）。`;
        process.stderr.write(`\n⚠ ${msg}\n`);
        process.stderr.write('adapters.mjs 是任意 Node 代码，将以你的用户权限执行。仅加载你信任的文件。\n');
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          const ans = (await rl.question('继续加载？(y/N) ')).trim().toLowerCase();
          return ans === 'y' || ans === 'yes';
        } finally {
          rl.close();
        }
      },
      warn: (m) => process.stderr.write(`⚠ ${m}\n`),
    });
    for (const a of jsResult.adapters) {
      if (adapters.has(a.name)) {
        process.stderr.write(`⚠ adapter "${a.name}" 已由 builtin 提供，跳过 adapters.mjs 同名注册\n`);
        continue;
      }
      adapters.set(a.name, a);
    }
    // 信任新确认：把当前 mtime 写回 prefs.yaml.security.adapters_mjs_trusted_mtime
    if (jsResult.trustNewlyConfirmed && jsResult.trustDecision.kind === 'needs_confirmation') {
      try {
        const { statSync, writeFileSync, readFileSync } = await import('node:fs');
        const { parse, stringify } = await import('yaml');
        const mtime = statSync(paths.adaptersMjs).mtimeMs;
        const raw = readFileSync(paths.prefsYaml, 'utf8');
        const doc = parse(raw) as Record<string, unknown>;
        const sec = (doc.security ??= {}) as Record<string, unknown>;
        sec.adapters_mjs_trusted_mtime = Math.floor(mtime);
        writeFileSync(paths.prefsYaml, stringify(doc), { encoding: 'utf8', mode: 0o600 });
      } catch {
        // 写盘失败：下次启动会再次询问，不阻塞当前 run
      }
    }
  }

  // ─── enabledModels：仅 enabled=true 的进入 enabledModels map ───
  const enabledModels = new Map<string, ModelConfig>();
  for (const [name, cfg] of Object.entries(configs.models.models)) {
    if (cfg.enabled === true) enabledModels.set(name, cfg);
  }

  // ─── adapter 版本探测（仅 enabled adapter；失败不阻塞 run，记 "(unknown)"） ───
  const adapterVersions: Record<string, string> = {};
  for (const [name] of enabledModels) {
    const adapter = adapters.get(name);
    if (!adapter) continue;
    try {
      adapterVersions[name] = await adapter.version();
    } catch {
      adapterVersions[name] = '(unknown)';
    }
  }

  // ─── language 解析 ───
  const systemLang = deriveSystemLanguage(process.env);
  const requestedRaw = parseRequestedOutputLanguage({
    cliRaw: opts.lang,
    prefRaw: configs.prefs.language.output,
  });
  const requestedOutput: RequestedOutputLanguage = requestedRaw.request.value;
  if (requestedRaw.warning !== undefined) {
    process.stderr.write(`⚠ ${requestedRaw.warning}\n`);
  }

  const uiResolve = resolveProvisionalUi({
    cliUiLangRaw: opts.uiLang,
    prefUiRaw: configs.prefs.language.ui,
    systemLang,
    prefOutputRaw: configs.prefs.language.output,
    fallbackLang: configs.prefs.language.fallback,
  });
  for (const w of uiResolve.warnings) process.stderr.write(`⚠ ${w}\n`);

  // 启动时 language state（auto / explicit 模式下 resolved_output 由 Enhancer 阶段或 explicit resolver 填）
  const initialLanguage: LanguageState = {
    system: systemLang,
    requested_output: requestedOutput,
    resolved_output: requestedOutput === 'auto' || requestedOutput === 'system'
      ? systemLang
      : requestedOutput,
    resolved_ui: uiResolve.provisional_ui,
    source: requestedRaw.request.origin === 'cli_override' ? 'cli_override' : 'user_pref',
    confidence: null,
    fallback_used: false,
  };

  // ─── effort 解析 ───
  let cliEffort: CliEffort | undefined;
  if (opts.effort !== undefined) {
    try {
      cliEffort = parseCliEffort(opts.effort, new Set(enabledModels.keys()));
    } catch (err) {
      throw new CliError((err as Error).message, ExitCode.UsageError);
    }
  }

  // ─── roles fallback：roles.yaml 缺失时取启用列表第一个 model ───
  const roles = configs.roles ?? {
    enhancer: {
      mode: 'fixed' as const,
      model: [...enabledModels.keys()][0]!,
    },
    executor: {
      mode: 'fixed' as const,
      model: [...enabledModels.keys()][0]!,
    },
  };

  // ─── enhancer adapter ───
  const enhancerModel = opts.enhancer ?? roles.enhancer.model;
  if (enhancerModel === undefined) {
    throw new CliError('enhancer model not configured', ExitCode.ConfigError);
  }
  const enhancerAdapter = adapters.get(enhancerModel);
  if (enhancerAdapter === undefined) {
    throw new CliError(`enhancer adapter ${enhancerModel} not found`, ExitCode.ConfigError);
  }

  // ─── stdout presenter（共享同一个 emitter；caller 把 emitter 注入 runOrchestrator？
  // runOrchestrator 内部 new RunContext({}) 自带 emitter；为统一订阅，我们让 runOrchestrator
  // 在 PersistenceCallbacks.onEvent 中转发到本地 emitter） ───
  const presenterEmitter = new EventEmitter();
  const verbosity = resolveVerbosity(opts);
  const disposePresenter = startStdoutPresenter({
    emitter: presenterEmitter,
    // v0.1.0：ink runtime 尚未接入（spec "阶段 7 留 ink"），prefs.ui.tui=on 时若 silence stderr
    // 会让用户在多 agent 圆桌 5-10 分钟里看不到任何进度。强制走 stderr 进度直到 v0.2.0
    // 接入真正的 ink 组件树后再尊重 opts.tui。
    tuiOn: false,
    verbosity,
    noPersist: !opts.persist,
  });

  // ─── redact_patterns（来自 §security-privacy "敏感输入与持久化控制"）───
  // 落盘前对所有字符串字段递归应用 regex 替换；运行时 emitter 转发不受影响（stdout 显示原文，
  // 由用户在终端自己负责），仅持久化字节流被脱敏。
  const redactor = buildRedactor(configs.prefs.history.redact_patterns);
  const deepRedact = (v: unknown): unknown => {
    if (typeof v === 'string') return redactor(v);
    if (Array.isArray(v)) return v.map(deepRedact);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = deepRedact(val);
      return out;
    }
    return v;
  };

  // web view server 实例需在 persistCallbacks 闭包内被引用；声明上提（实际启动在下面）
  let webViewServer: import('../web-view/server.js').WebViewServer | null = null;

  // ─── persistence callbacks（除 --no-persist 外） ───
  const runsIo = new RunsIo(paths);
  let runId: string | null = null;
  const persistCallbacks: PersistenceCallbacks | undefined = opts.persist
    ? {
        onPersistable: (initialMeta) => {
          runId = initialMeta.run_id as string;
          runsIo.initRunDir(runId, deepRedact(initialMeta) as Record<string, unknown>);
          if (webViewServer !== null) webViewServer.setRunId(runId);
        },
        onEvent: (event: Event) => {
          if (runId !== null) {
            try {
              // 仅 event.data 走 redact；type / timestamp / run_id / round 是结构字段不需脱敏
              const redactedEvent = { ...event, data: deepRedact(event.data) } as Event;
              runsIo.appendEvent(runId, redactedEvent);
            } catch {
              // 单事件写盘失败不阻塞
            }
          }
          // 同时转发到本地 emitter 给 stdout presenter（保留原文，仅终端显示）
          presenterEmitter.emit(event);
        },
        onFinal: ({ markdown, finalMeta }) => {
          if (runId === null) return;
          // 补 adapter_versions：仅对 participants 探测，避免给未参与的 adapter 探版本
          finalMeta.adapter_versions = adapterVersions;
          const redactedMeta = deepRedact(finalMeta) as Record<string, unknown>;
          runsIo.writeMeta(runId, redactedMeta);
          if (markdown !== null) {
            const redactedMd = redactor(markdown);
            runsIo.writeFinalMd(runId, redactedMd ?? markdown);
          }
        },
      }
    : undefined;

  // ─── 如果 --no-persist：仍需要把 emitter 接入 presenter（让进度行能写到 stderr） ───
  if (persistCallbacks === undefined) {
    // 无 persist：直接订阅 runOrchestrator 内部 emitter 不可能（emitter 在 RunContext 内部）；
    // 退而求其次：单 agent direct / multi 主线由 stderr 自己输出关键进度
    // 由于本简化，--no-persist 模式下 stdout presenter 接 emitter 不工作；TUI off 模式仍然输出 final markdown
  }

  // ─── Web view（HTML 预览）— 由 prefs.ui.web_view + --web-view 覆盖控制 ───
  // 来自 §presenters "Web view presenter（默认开启）"；v0.1.0 提前实现（原计划 v0.2.0）
  const webViewMode = opts.webView ?? configs.prefs.ui.web_view;
  if (webViewMode !== 'off') {
    const { WebViewServer, openInBrowser } = await import('../web-view/server.js');
    webViewServer = new WebViewServer({
      port: configs.prefs.ui.web_port,
      rawQuestion: question ?? '',
    });
    try {
      const port = await webViewServer.start();
      const url = `http://127.0.0.1:${port}`;
      process.stderr.write(`🌐 web view: ${url}\n`);
      if (webViewMode === 'on') {
        await openInBrowser(url);
      }
      // 订阅本地 emitter（presenterEmitter 是 stderr presenter 的事件源；持久化路径会把每个事件
      // 转发到此 emitter——见上方 onEvent 实现）→ mutate web view state
      const wv = webViewServer;
      const { ALL_EVENTS } = await import('../shared/event-emitter.js');
      presenterEmitter.subscribe(ALL_EVENTS, (evt: Event) => {
        const data = evt.data as Record<string, unknown>;
        switch (evt.type) {
          case 'enhancement_started':
            wv.setEnhancerStatus('pending');
            break;
          case 'enhancement_completed':
            wv.setEnhancerStatus('done');
            if (typeof data.scene === 'string') wv.setScene(data.scene);
            if (typeof data.enhanced_question === 'string') wv.setEnhancedQuestion(data.enhanced_question);
            break;
          case 'user_input_received':
            wv.setUserConfirmed(data.decision === 'confirm');
            break;
          case 'round_started': {
            const active = Array.isArray(data.active_agents)
              ? (data.active_agents as string[])
              : typeof data.active_agents === 'string'
                ? data.active_agents.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
                : [];
            wv.startRound(evt.round ?? 0, active);
            break;
          }
          case 'agent_responded':
            wv.recordAgentResult(evt.round ?? 0, String(data.agent ?? '?'), {
              ok: true,
              durationMs: Number(data.duration_ms ?? 0),
            });
            break;
          case 'agent_errored':
            wv.recordAgentResult(evt.round ?? 0, String(data.agent ?? '?'), {
              ok: false,
              error: String(data.error ?? ''),
            });
            break;
          case 'round_completed':
            wv.endRound(evt.round ?? 0);
            break;
          case 'finalized':
            if (data.outcome === 'aborted') wv.setAborted(String(data.reason ?? ''));
            else if (data.outcome === 'cancelled') wv.setCancelled();
            break;
          case 'finalized_converged':
          case 'finalized_escaped':
          case 'finalized_single_agent':
            if (typeof data.markdown === 'string') wv.setFinal(data.markdown);
            break;
        }
      });

      // 注入追问回调：POST /api/followup 触发；与 CLI 主流程同一个 process 内拉起新 run
      wv.setOnFollowup(async (followupQuestion) => {
        const tail = wv.getState().thread[wv.getState().thread.length - 1];
        if (!tail || tail.runId === null) {
          throw new Error('parent run id not available');
        }
        const parentRunId = tail.runId;
        const nextDepth = tail.followupDepth + 1;
        // 在 thread 推一段新 run（占位）；后续 runMainQuestion 的 onPersistable 会写 runId
        wv.pushFollowupRun({
          rawQuestion: followupQuestion,
          parentRunId,
          followupDepth: nextDepth,
        });
        // 异步拉起；不要 await，让 POST 立即返回 new runId
        const { prepareFollowupContext } = await import('../orchestrator/followup.js');
        const io = new RunsIo(paths);
        const followupContext = prepareFollowupContext({ io, parentRunId });
        void runMainQuestion({
          question: followupQuestion,
          opts,
          configs,
          paths,
          followupContext,
        }).catch((err) => {
          wv.setAborted(`followup 失败：${(err as Error).message}`);
        });
        // 等 tail.runId 被 onPersistable 写入（最多 30s）
        const start = Date.now();
        while (Date.now() - start < 30_000) {
          const t = wv.getState().thread[wv.getState().thread.length - 1];
          if (t?.runId !== null && t?.runId !== undefined) return t.runId;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error('runId not produced within 30s');
      });
    } catch (e) {
      process.stderr.write(`⚠ web view 启动失败：${(e as Error).message}\n`);
      webViewServer = null;
    }
  }

  // ─── 用户确认回调（TUI off / 非 TTY 时简化处理；追问场景跳过确认） ───
  const userConfirm = async (info: {
    enhancedQuestion: string;
    scene: string;
    sceneSource: string;
  }): Promise<'confirm' | 'cancel'> => {
    if (followupContext !== undefined) return 'confirm';

    const haveTty = process.stdin.isTTY === true;
    const haveWeb = webViewServer !== null;

    if (!haveTty && !haveWeb) {
      // 没有交互通道：自动确认（旧行为）
      return 'confirm';
    }

    // 准备 web view 等待（如果有）
    let webPromise: Promise<'confirm' | 'cancel'> | null = null;
    if (haveWeb && webViewServer !== null) {
      webPromise = webViewServer.awaitConfirmation({
        enhancedQuestion: info.enhancedQuestion,
        scene: info.scene,
        sceneSource: info.sceneSource,
      });
      const url = webViewServer.url();
      process.stderr.write(`\n🌐 也可在浏览器 ${url} 上确认\n`);
    }

    // 准备 stdin 等待（如果有 TTY）
    let stdinPromise: Promise<'confirm' | 'cancel'> | null = null;
    let rl: ReturnType<typeof createInterface> | null = null;
    if (haveTty) {
      rl = createInterface({ input: process.stdin, output: process.stderr });
      process.stderr.write(`\nscene: ${info.scene} (${info.sceneSource})\n`);
      process.stderr.write('补全后的问题：\n');
      process.stderr.write('\n' + info.enhancedQuestion + '\n\n');
      stdinPromise = rl.question('继续? (Y/n): ').then((ans) => {
        const a = ans.trim().toLowerCase();
        return a === '' || a === 'y' || a === 'yes' ? 'confirm' : 'cancel';
      });
    }

    try {
      const candidates: Promise<'confirm' | 'cancel'>[] = [];
      if (webPromise !== null) candidates.push(webPromise);
      if (stdinPromise !== null) candidates.push(stdinPromise);
      const decision = await Promise.race(candidates);
      return decision;
    } finally {
      if (rl !== null) rl.close();
      if (webViewServer !== null) webViewServer.clearPendingConfirmation();
    }
  };

  // ─── 调 runOrchestrator ───
  try {
    const result = await runOrchestrator({
      rawQuestion: question,
      enabledModels,
      scenes: configs.scenes,
      roles,
      adapters,
      initialLanguage,
      requestedOutput,
      defaultEffort: 'medium',
      ...(cliEffort !== undefined ? { cliEffort } : {}),
      ...(opts.scene !== undefined ? { sceneOverride: opts.scene } : {}),
      ...(opts.executor !== undefined ? { executorOverride: opts.executor } : {}),
      enhancer: { adapter: enhancerAdapter, model: enhancerModel, effort: 'medium' },
      userConfirm,
      noPersist: !opts.persist,
      maxRoundsCap: configs.prefs.defaults.max_rounds,
      // 单 agent invoke 超时：取所有 enabled models 的 timeout_s 最小值（秒→毫秒）。
      // orchestrator 当前用同一 timeout 给所有 adapter；最小值保守，避免慢 agent 拖死整轮。
      timeoutMs: (() => {
        const ts = [...enabledModels.values()].map((m) => m.timeout_s);
        if (ts.length === 0) return 5 * 60 * 1000;
        return Math.min(...ts) * 1000;
      })(),
      ...(persistCallbacks !== undefined ? { persist: persistCallbacks } : {}),
      ...(followupContext !== undefined ? { followupContext } : {}),
    });

    // final.md 已由 stdout presenter 在 finalized_* 事件触发时写入；
    // 这里**不**再手动 write（否则会重复输出）。
    //
    // 仅 --no-persist 模式下 presenter 拿不到事件（事件不经 onEvent 转发），
    // 此时手动写一次：
    if (persistCallbacks === undefined && result.finalMarkdown !== null) {
      process.stdout.write(result.finalMarkdown);
      if (!result.finalMarkdown.endsWith('\n')) process.stdout.write('\n');
    }

    disposePresenter();

    // web view: run 完成后保持 server 运行让用户查看；按 Ctrl+C 关闭
    if (webViewServer !== null) {
      const url = webViewServer.url();
      process.stderr.write(`\n🌐 web view 仍在 ${url} 运行中。按 Ctrl+C 关闭并退出。\n`);
      await new Promise<void>((resolve) => {
        const handler = async () => {
          process.off('SIGINT', handler);
          if (webViewServer !== null) await webViewServer.close();
          resolve();
        };
        process.on('SIGINT', handler);
      });
    }

    // 退出码
    if (result.kind === 'aborted') return ExitCode.RuntimeError;
    if (result.kind === 'cancelled') return ExitCode.Success;
    return ExitCode.Success;
  } catch (err) {
    disposePresenter();
    if (webViewServer !== null) await webViewServer.close();
    throw err;
  }
}

function announceDecision(
  decision: ReturnType<typeof routeQuestion>,
  verbosity: 'quiet' | 'normal' | 'verbose',
): void {
  if (verbosity === 'quiet') return;
  switch (decision.kind) {
    case 'single_agent_direct':
      process.stderr.write(`→ single agent direct: ${decision.theOnlyAgent}\n`);
      break;
    case 'enhance_then_layer2':
      process.stderr.write(`→ multi-agent route: ${decision.enabledModelNames.join(', ')}\n`);
      break;
    default:
      break;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => handleTopLevelError(err));
