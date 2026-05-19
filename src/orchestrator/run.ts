import type { Adapter, EffortLevel } from '../shared/adapter.js';
import type { ModelConfig } from '../config/schemas/models.js';
import type { SceneConfig, ScenesFile } from '../config/schemas/scenes.js';
import type { RolesFile } from '../config/schemas/roles.js';
import type { LanguageState, RequestedOutputLanguage } from '../lang/types.js';
import type { PriorChainEntry } from '../persistence/followup.js';
import { decideLayer1, decideLayer2, decideLayer2GeneralFallback } from './branching.js';
import { ALL_EVENTS } from '../shared/event-emitter.js';
import { EventType, type Event } from '../shared/event-types.js';
import { RunContext } from './run-context.js';
import { State, StateMachine } from './state-machine.js';
import { runEnhancer } from '../enhancer/index.js';
import { resolveEffort, type CliEffort } from '../config/effort.js';
import { runRound, BlacklistTracker } from './round-loop.js';
import type { Round1Output, Round2PlusOutput } from '../shared/agent-output-schema.js';
import { checkConverged } from './convergence.js';
import { checkActive } from './active-check.js';
import { resolveExecutor } from './executor-resolve.js';
import { invokeSingleAgent } from './single-agent.js';
import { UsageAggregator } from '../usage/aggregator.js';
import { renderFinal } from '../finalizer/index.js';
import {
  resolveAutoOutput,
  resolveExplicitOutput,
  resolveOutputForSingleAgentDirect,
} from '../lang/resolver.js';
import { finalizeUiLanguage } from '../lang/ui-resolver.js';

/**
 * Orchestrator 高级入口（runOrchestrator）。
 *
 * 来自 §roundtable-orchestrator 状态机驱动 + tasks.md §8.4 §20.2 + 跨阶段约束全部条款。
 *
 * 把阶段 1-7 的 builder block 装配成"用户输入 → final markdown + events 序列"完整 pipeline。
 *
 * v0.1.0 范围：
 * - **不**含真实 CLI 调用（caller 注入 adapters；测试用 mock；生产用阶段 3 内置 adapter）
 * - **不**含 TUI / Persistence 直接调用——本函数订阅 RunContext.emitter，调用方接 presenters / persistence
 * - **不**含用户交互（Enhancer 反问 / 确认页）——caller 决定如何确认；本函数接受 `userConfirmed` 回调
 *
 * 返回：RunResult 含最终 markdown / events / language / usage / meta payload，调用方决定落盘 / TUI / stdout 渲染。
 */

export interface RunOrchestratorArgs {
  rawQuestion: string;
  enabledModels: ReadonlyMap<string, ModelConfig>;
  scenes: ScenesFile;
  roles: RolesFile;
  adapters: ReadonlyMap<string, Adapter>;
  /** 当前 language 解析（来自阶段 4 lang/resolver 的结果） */
  initialLanguage: LanguageState;
  requestedOutput: RequestedOutputLanguage;
  /** 默认 effort（来自 prefs / model defaults） */
  defaultEffort: EffortLevel;
  cliEffort?: CliEffort;
  /** scene override（--scene） */
  sceneOverride?: string;
  /** executor override（--executor） */
  executorOverride?: string;
  enhancer: { adapter: Adapter; model: string; effort: EffortLevel };
  /** 用户确认回调：返回 'confirm' 继续，'cancel' 走 CANCELLED 路径 */
  userConfirm: (args: {
    enhancedQuestion: string;
    scene: string;
    sceneSource: 'auto' | 'cli_override' | 'fallback_general';
  }) => Promise<'confirm' | 'cancel'>;
  /** 是否 --no-persist（影响 RunContext + final.md 渲染） */
  noPersist?: boolean;
  /** 单 agent invoke timeout（毫秒） */
  timeoutMs?: number;
  /** max rounds 全局限制（来自 prefs.defaults.max_rounds 与 scene.max_rounds 取小） */
  maxRoundsCap?: number;
  /**
   * 可选持久化注入。
   *
   * 来自 §persistence-history "Run 目录持久化时机" + 跨阶段约束 #11。
   *
   * - mock 测试 / `--no-persist` 不传 → runOrchestrator 仅在内存 emit，不落盘
   * - 生产 / CLI 主入口注入 → 按 spec 时机写盘：
   *   - markPersistable 时调 `onPersistable(meta)` → 落盘 meta.json + 回填 events buffer
   *   - 每个事件实时调 `onEvent(event)` → append events.jsonl
   *   - finalize 时调 `onFinal({ markdown, finalMeta })` → 写 final.md + 覆写 meta.json
   *
   * spec §security-privacy "敏感输入与持久化控制"：caller 应在 onPersistable / onFinal
   * 内部对 raw_question / enhanced_question / agent answer 应用 redact_patterns。
   */
  persist?: PersistenceCallbacks;
  /**
   * 追问上下文（来自 §followup-rounds）。
   *
   * 非空时：
   * - enhancer prompt 含 prior chain 段；调用方 SHOULD 同时通过 userConfirm 注入 auto-confirm
   * - Round 1 prompt 末尾追加 prior chain 段
   * - 落盘 meta.json 时写 parent_run_id / followup_depth
   */
  followupContext?: FollowupContext;
}

export interface FollowupContext {
  /** 追问链（最旧在前，含 parent） */
  chain: readonly PriorChainEntry[];
  /** 直接 parent 的 run_id；写入新 run meta.parent_run_id */
  parentRunId: string;
  /** parent 的 followup_depth + 1；写入新 run meta.followup_depth */
  depth: number;
}

export interface PersistenceCallbacks {
  /** markPersistable 时调用（多 agent / downgraded 用户确认后；direct 进入 INVOKING 状态时） */
  onPersistable: (initialMeta: Record<string, unknown>) => void;
  /** 每个事件调用（含 markPersistable 后回填的 buffered 事件） */
  onEvent: (event: Event) => void;
  /** finalize 时调用（最终 markdown + 完整 meta） */
  onFinal: (args: { markdown: string | null; finalMeta: Record<string, unknown> }) => void;
}

export interface RunResult {
  kind: 'multi_agent_converged' | 'multi_agent_escaped' | 'single_agent' | 'aborted' | 'cancelled';
  /** final markdown（aborted / cancelled 时为 null） */
  finalMarkdown: string | null;
  /** RunContext run_id */
  runId: string;
  /** 最终 language 状态 */
  language: LanguageState;
  /** UsageAggregator 输出 */
  usage: ReturnType<UsageAggregator['build']>;
  /** 多 agent 路径完成的轮数 */
  roundsCompleted: number;
  /** 多 agent 路径最终 active agents */
  participants: string[];
  /** 选定的 executor（多 agent 路径） */
  executor?: string;
  /** executor fallback 触发标记 */
  executorFallbackUsed?: boolean;
  originalExecutorModel?: string | null;
  /** scene 名 */
  scene: string;
  sceneSource: 'auto' | 'cli_override' | 'fallback_general' | 'forced_general_direct';
  sceneFallbackUsed: boolean;
  /** 单 agent 类型（kind === 'single_agent' 时填充） */
  singleAgentKind?: 'direct' | 'downgraded';
  /** abort/cancel reason（kind === 'aborted' / 'cancelled' 时填充） */
  abortReason?: string;
  /** enhanced_question（多 agent / downgraded 路径填充；direct 路径为 null） */
  enhancedQuestion?: string | null;
  /** executor 实际生效的 mode（多 agent 路径填充） */
  executorMode?: 'fixed' | 'rotate' | 'random' | 'per_scene' | null;
}

/**
 * 主入口。装配完整 Orchestrator pipeline。
 *
 * 流程：
 * 1. Layer 1 粗分支（enabled_models.length 0/1/>=2）
 * 2. enabled=1 → 单 agent direct（跳过 Enhancer，强制 general scene）
 * 3. enabled>=2 → Enhancer → 用户确认页 → Layer 2 三重交集
 * 4. Layer 2 == 1 → 单 agent downgraded
 * 5. Layer 2 == 0 → recompute general scene；二次仍 0 → ABORT_NO_PARTICIPANTS
 * 6. Layer 2 >= 2 → Round loop until converged / escaped
 * 7. Finalizer 渲染 markdown
 */
export async function runOrchestrator(args: RunOrchestratorArgs): Promise<RunResult> {
  const ctx = new RunContext({ noPersist: args.noPersist === true });
  const sm = new StateMachine();
  const aggregator = new UsageAggregator();
  const enabledNames = [...args.enabledModels.keys()];
  const layer1 = decideLayer1(enabledNames);

  // ─── Persistence 桥接（来自 §persistence-history "Run 目录持久化时机"） ───
  // - --no-persist 模式：跳过所有 persist callbacks（即使 caller 传了）
  // - 否则订阅 emitter 实时转发事件；markPersistable 时 flush buffer + onPersistable
  let persistEnabled = args.persist !== undefined && args.noPersist !== true;
  let persistableTriggered = false;
  const persistUnsub = persistEnabled
    ? ctx.emitter.subscribe(ALL_EVENTS, (evt) => {
        // 仅在 markPersistable 之后才转发实时事件；
        // 之前的事件由 onPersistable 回填 buffer 一次性处理
        if (persistableTriggered) args.persist!.onEvent(evt);
      })
    : () => {};
  const triggerPersistable = (initialMeta: Record<string, unknown>): void => {
    if (!persistEnabled || persistableTriggered) return;
    persistableTriggered = true;
    args.persist!.onPersistable(initialMeta);
    // 回填 buffer（确认前累积的 enhancement_* / user_input_* 事件）
    for (const evt of ctx.drainBuffer()) {
      args.persist!.onEvent(evt);
    }
  };
  const triggerFinal = (markdown: string | null, finalMeta: Record<string, unknown>): void => {
    if (!persistEnabled) return;
    // 仅在已 markPersistable（即 runs/<uuid>/ 已落盘）后才调 onFinal；
    // 否则（如 Enhancer 阶段崩溃 / 用户 cancel）caller 不应尝试写 final.md
    if (!persistableTriggered) return;
    args.persist!.onFinal({ markdown, finalMeta });
  };
  /** 所有返回点用 finalize 包一层：onFinal 写盘 + 取消 emitter 订阅。 */
  const finalize = (result: RunResult): RunResult => {
    triggerFinal(result.finalMarkdown, buildFinalMeta(result, ctx, args));
    persistUnsub();
    return result;
  };

  // ─── ABORT_EMPTY ───
  if (layer1.kind === 'abort_empty') {
    sm.transition(State.AbortEmpty);
    ctx.emit(EventType.Finalized, { outcome: 'aborted', reason: 'no enabled models' });
    return finalize({
      kind: 'aborted',
      finalMarkdown: null,
      runId: ctx.runId,
      language: args.initialLanguage,
      usage: aggregator.build(),
      roundsCompleted: 0,
      participants: [],
      scene: 'general',
      sceneSource: 'forced_general_direct',
      sceneFallbackUsed: false,
      abortReason: '未启用任何 model',
    });
  }

  // ─── SINGLE_AGENT_DIRECT ───
  if (layer1.kind === 'single_agent_direct') {
    sm.transition(State.SingleAgentDirectInvoking);
    // direct 路径强制 general scene
    const scene = args.scenes.scenes.general;
    if (scene === undefined) {
      sm.transition(State.AbortNoParticipants);
      ctx.emit(EventType.Finalized, { outcome: 'aborted', reason: 'general scene missing' });
      return finalize({
        kind: 'aborted',
        finalMarkdown: null,
        runId: ctx.runId,
        language: args.initialLanguage,
        usage: aggregator.build(),
        roundsCompleted: 0,
        participants: [],
        scene: 'general',
        sceneSource: 'forced_general_direct',
        sceneFallbackUsed: false,
        abortReason: 'general scene missing in scenes.yaml',
      });
    }
    // direct 路径**立即**落盘（spec §persistence-history "Run 目录持久化时机"：
    // 单 agent direct 进入 SINGLE_AGENT_DIRECT_INVOKING 状态时立即创建目录）
    ctx.markPersistable();
    triggerPersistable({
      run_id: ctx.runId,
      schema_version: 1,
      path: 'single_agent',
      single_agent_kind: 'direct',
      started_at: ctx.startedAt,
      raw_question: args.rawQuestion,
      enhanced_question: null,
      scene: 'general',
      scene_source: 'forced_general_direct',
      scene_fallback_used: false,
      participants: [layer1.theOnlyAgent],
      enhancer_model: null,
      parent_run_id: args.followupContext?.parentRunId ?? null,
      followup_depth: args.followupContext?.depth ?? 0,
    });

    const lang = resolveOutputForSingleAgentDirect({
      request: { value: args.requestedOutput, origin: 'user_pref' },
      systemLang: args.initialLanguage.system,
    });
    const finalLanguage: LanguageState = {
      ...args.initialLanguage,
      resolved_output: lang.resolved,
      source: lang.source,
      fallback_used: false,
    };
    const adapter = args.adapters.get(layer1.theOnlyAgent);
    if (adapter === undefined) {
      sm.transition(State.AbortNoParticipants);
      return finalize(abortResult(ctx, aggregator, finalLanguage, `adapter ${layer1.theOnlyAgent} not found`));
    }

    ctx.emit(EventType.SingleAgentStarted, { kind: 'direct', agent: layer1.theOnlyAgent });
    const invocation = await invokeSingleAgent({
      question: args.rawQuestion,
      adapter,
      agentName: layer1.theOnlyAgent,
      scene,
      resolvedOutputLanguage: finalLanguage.resolved_output,
      effort: args.defaultEffort,
      timeoutMs: args.timeoutMs ?? 5 * 60 * 1000,
      kind: 'direct',
    });
    if (!invocation.ok) {
      sm.transition(State.AbortNoParticipants);
      ctx.emit(EventType.AgentErrored, { agent: layer1.theOnlyAgent, error: invocation.error });
      ctx.emit(EventType.Finalized, { outcome: 'aborted', reason: invocation.error });
      return finalize(abortResult(ctx, aggregator, finalLanguage, invocation.error));
    }
    aggregator.record(layer1.theOnlyAgent, 1, invocation.usage);
    ctx.emit(EventType.AgentResponded, {
      agent: layer1.theOnlyAgent,
      raw_head: invocation.output.answer.split('\n').slice(0, 3).join('\n'),
      usage: invocation.usage,
    });
    sm.transition(State.FinalizingSingle);

    const md = renderFinal({
      kind: 'single_agent',
      question: args.rawQuestion,
      output: invocation.output,
      agent: layer1.theOnlyAgent,
      scene: 'general',
      runId: ctx.runId,
      resolvedUiLanguage: finalLanguage.resolved_ui,
      noPersist: args.noPersist === true,
      singleAgentKind: 'direct',
    });
    sm.transition(State.Done);
    ctx.emit(EventType.FinalizedSingleAgent, { markdown: md, agent: layer1.theOnlyAgent });
    ctx.emit(EventType.Finalized, { outcome: 'single_agent_completed' });

    return finalize({
      kind: 'single_agent',
      finalMarkdown: md,
      runId: ctx.runId,
      language: finalLanguage,
      usage: aggregator.build(),
      roundsCompleted: 0,
      participants: [layer1.theOnlyAgent],
      scene: 'general',
      sceneSource: 'forced_general_direct',
      sceneFallbackUsed: false,
      singleAgentKind: 'direct',
    });
  }

  // ─── ENHANCE_THEN_LAYER2 ───
  sm.transition(State.Enhancing);
  ctx.emit(EventType.EnhancementStarted);

  const enhancerResult = await runEnhancer({
    rawQuestion: args.rawQuestion,
    scenes: args.scenes,
    requestedOutput: args.requestedOutput,
    preResolvedLanguage: explicitPreResolved(args),
    adapter: args.enhancer.adapter,
    effort: args.enhancer.effort,
    sceneOverride: args.sceneOverride,
    priorChain: args.followupContext?.chain,
  });

  let enhancedQuestion: string;
  let scene: SceneConfig;
  let sceneName: string;
  let sceneSource: 'auto' | 'cli_override' | 'fallback_general';
  let sceneFallbackUsed: boolean;
  let language: LanguageState;
  let enhancerFallbackUsed = false;
  let enhancerFailureReason: 'adapter_errored' | 'json_parse_failed' | 'timeout' | undefined;

  if (enhancerResult.kind === 'success') {
    enhancedQuestion = enhancerResult.enhanced_question;
    sceneName = enhancerResult.scene;
    sceneSource = enhancerResult.scene_source;
    sceneFallbackUsed = enhancerResult.scene_fallback_used;
    language = enhancerResult.language;
    const found = args.scenes.scenes[sceneName];
    if (found === undefined) {
      const general = args.scenes.scenes.general;
      if (general === undefined) {
        return abortResult(ctx, aggregator, language, 'general scene missing');
      }
      scene = general;
      sceneName = 'general';
      sceneSource = 'fallback_general';
      sceneFallbackUsed = true;
    } else {
      scene = found;
    }
  } else {
    enhancedQuestion = enhancerResult.fallback.enhanced_question;
    sceneName = 'general';
    sceneSource = 'fallback_general';
    sceneFallbackUsed = true;
    language = enhancerResult.fallback.language;
    enhancerFallbackUsed = true;
    enhancerFailureReason = enhancerResult.fallback.failure_reason;
    const general = args.scenes.scenes.general;
    if (general === undefined) {
      return finalize(abortResult(ctx, aggregator, language, 'general scene missing'));
    }
    scene = general;
  }
  void enhancerFallbackUsed;
  void enhancerFailureReason;

  ctx.emit(EventType.EnhancementCompleted, {
    scene: sceneName,
    scene_source: sceneSource,
    questions_for_user: enhancerResult.kind === 'success' ? enhancerResult.questions_for_user : [],
    fallback_used: enhancerResult.kind === 'failure',
    ...(enhancerResult.kind === 'failure'
      ? { failure_reason: enhancerResult.fallback.failure_reason }
      : {}),
  });

  // 用户确认页
  sm.transition(State.AwaitingUserConfirm);
  ctx.emit(EventType.UserInputRequested, { enhanced_question: enhancedQuestion });
  const decision = await args.userConfirm({
    enhancedQuestion,
    scene: sceneName,
    sceneSource,
  });
  if (decision === 'cancel') {
    // CANCELLED 路径：spec §persistence-history "Run 目录持久化时机"：
    // "用户选 n 取消 → 丢弃内存中的 run_id 与已收集事件，**不**创建任何目录与文件"
    // 因此 cancelled 路径**不**调用 triggerPersistable / triggerFinal；仅释放 emitter 订阅
    sm.transition(State.Cancelled);
    sm.transition(State.Done);
    ctx.emit(EventType.UserInputReceived, { decision: 'cancel' });
    ctx.emit(EventType.Finalized, { outcome: 'cancelled' });
    ctx.discard();
    persistUnsub();
    return {
      kind: 'cancelled',
      finalMarkdown: null,
      runId: ctx.runId,
      language,
      usage: aggregator.build(),
      roundsCompleted: 0,
      participants: [],
      scene: sceneName,
      sceneSource,
      sceneFallbackUsed,
    };
  }
  ctx.emit(EventType.UserInputReceived, { decision: 'confirm' });

  // 用户确认 → 落盘开始（多 agent + downgraded 共享触发点）
  sm.transition(State.BranchingAfterConfirm);
  ctx.markPersistable();
  triggerPersistable({
    run_id: ctx.runId,
    schema_version: 1,
    path: 'multi_agent', // 后续若走 downgraded 会在 onFinal 覆盖
    started_at: ctx.startedAt,
    raw_question: args.rawQuestion,
    enhanced_question: enhancedQuestion,
    scene: sceneName,
    scene_source: sceneSource,
    scene_fallback_used: sceneFallbackUsed,
    enhancer_model: args.enhancer.model,
    enhancer: {
      fallback_used: enhancerFallbackUsed,
      ...(enhancerFailureReason !== undefined ? { failure_reason: enhancerFailureReason } : {}),
    },
    parent_run_id: args.followupContext?.parentRunId ?? null,
    followup_depth: args.followupContext?.depth ?? 0,
  });

  // Layer 2 三重交集
  const layer2 = decideLayer2({ scene, enabledModels: args.enabledModels });
  let participants: string[];
  if (layer2.kind === 'multi_agent_round') {
    participants = layer2.participants;
  } else if (layer2.kind === 'single_agent_downgraded') {
    participants = [layer2.participant];
    return finalize(
      await runSingleAgentDowngraded({
        args,
        ctx,
        sm,
        aggregator,
        language,
        scene,
        sceneName,
        sceneSource,
        sceneFallbackUsed,
        participant: layer2.participant,
        enhancedQuestion, // spec §roundtable-orchestrator: downgraded 用 enhanced_question 保留 Enhancer 上下文
      }),
    );
  } else {
    sm.transition(State.RecomputeWithGeneralScene);
    const general = args.scenes.scenes.general;
    if (general === undefined) {
      return finalize(abortResult(ctx, aggregator, language, 'general scene missing for recompute'));
    }
    const recompute = decideLayer2GeneralFallback({ generalScene: general, enabledModels: args.enabledModels });
    sceneFallbackUsed = true;
    sceneName = 'general';
    sceneSource = 'fallback_general';
    if (recompute.kind === 'multi_agent_round') {
      participants = recompute.participants;
      scene = general;
    } else if (recompute.kind === 'single_agent_downgraded') {
      return finalize(
        await runSingleAgentDowngraded({
          args,
          ctx,
          sm,
          aggregator,
          language,
          scene: general,
          sceneName,
          sceneSource,
          sceneFallbackUsed,
          participant: recompute.participant,
          enhancedQuestion,
        }),
      );
    } else {
      sm.transition(State.AbortNoParticipants);
      ctx.emit(EventType.Finalized, { outcome: 'aborted', reason: recompute.reason });
      return finalize(abortResult(ctx, aggregator, language, recompute.reason));
    }
  }

  // 多 agent round loop
  return finalize(await runMultiAgentLoop({
    args,
    ctx,
    sm,
    aggregator,
    language,
    scene,
    sceneName,
    sceneSource,
    sceneFallbackUsed,
    participants,
    enhancedQuestion,
  }));
}

// ─── 辅助：buildFinalMeta（来自 spec §persistence-history "meta.json schema"） ───
function buildFinalMeta(
  result: RunResult,
  ctx: RunContext,
  args: RunOrchestratorArgs,
): Record<string, unknown> {
  const isSingle = result.kind === 'single_agent';
  const isCancelled = result.kind === 'cancelled';
  const isAborted = result.kind === 'aborted';
  const isConverged = result.kind === 'multi_agent_converged';

  const baseOutcome: 'converged' | 'escaped' | 'single_agent_completed' | 'aborted' = isAborted
    ? 'aborted'
    : isCancelled
      ? 'aborted' // 持久化层 outcome 不含 cancelled；cancelled 路径不写盘
      : isSingle
        ? 'single_agent_completed'
        : isConverged
          ? 'converged'
          : 'escaped';

  return {
    run_id: result.runId,
    schema_version: 1,
    path: isSingle ? 'single_agent' : 'multi_agent',
    ...(isSingle ? { single_agent_kind: result.singleAgentKind } : {}),
    started_at: ctx.startedAt,
    ended_at: new Date().toISOString(),
    raw_question: args.rawQuestion,
    // Codex review Bug #9 fix: 非 direct 路径用 RunResult.enhancedQuestion；direct 恒为 null
    enhanced_question:
      isSingle && result.singleAgentKind === 'direct'
        ? null
        : (result.enhancedQuestion ?? args.rawQuestion),
    scene: result.scene,
    scene_source: result.sceneSource,
    scene_fallback_used: result.sceneFallbackUsed,
    participants: result.participants,
    enhancer_model:
      isSingle && result.singleAgentKind === 'direct' ? null : args.enhancer.model,
    executor_model: result.executor ?? null,
    // Codex review Bug #11 fix: 用 RunResult.executorMode 而非硬写 "fixed"
    executor_mode: result.executor !== undefined ? (result.executorMode ?? 'fixed') : null,
    executor_fallback_used: result.executorFallbackUsed ?? false,
    original_executor_model: result.originalExecutorModel ?? null,
    rounds_completed: result.roundsCompleted,
    outcome: baseOutcome,
    language: {
      system: result.language.system,
      requested_output: result.language.requested_output,
      resolved_output: result.language.resolved_output,
      resolved_ui: result.language.resolved_ui,
      source: result.language.source,
      confidence: result.language.confidence,
      fallback_used: result.language.fallback_used,
    },
    usage: result.usage.usage,
    usage_totals: result.usage.usage_totals,
    adapter_versions: {} as Record<string, string>, // 由 caller 在 onFinal 中补
    enhancer: {
      fallback_used: false, // direct 路径恒为 false；其他路径由 caller 覆盖
    },
    parent_run_id: args.followupContext?.parentRunId ?? null,
    followup_depth: args.followupContext?.depth ?? 0,
  };
}

// ─── 辅助：abort 结果 ───
function abortResult(
  ctx: RunContext,
  aggregator: UsageAggregator,
  language: LanguageState,
  reason: string,
): RunResult {
  ctx.emit(EventType.Finalized, { outcome: 'aborted', reason });
  return {
    kind: 'aborted',
    finalMarkdown: null,
    runId: ctx.runId,
    language,
    usage: aggregator.build(),
    roundsCompleted: 0,
    participants: [],
    scene: 'general',
    sceneSource: 'forced_general_direct',
    sceneFallbackUsed: false,
    abortReason: reason,
  };
}

// ─── 辅助：multi-agent round loop ───
interface MultiAgentArgs {
  args: RunOrchestratorArgs;
  ctx: RunContext;
  sm: StateMachine;
  aggregator: UsageAggregator;
  language: LanguageState;
  scene: SceneConfig;
  sceneName: string;
  sceneSource: 'auto' | 'cli_override' | 'fallback_general';
  sceneFallbackUsed: boolean;
  participants: string[];
  enhancedQuestion: string;
}

async function runMultiAgentLoop(a: MultiAgentArgs): Promise<RunResult> {
  const { args, ctx, sm, aggregator, scene, participants, enhancedQuestion } = a;
  const blacklist = new BlacklistTracker();
  let activeAgents = [...participants];
  const previousOutputs = new Map<string, Round1Output | Round2PlusOutput>();
  // 注：包含 Round1Output 是为了 max_rounds=1 边界 case（escape finalizer / converged finalizer
  // 只读 .answer 字段，Round1Output 与 Round2PlusOutput 在该字段上同构；
  // disagreement-matrix 读 peer_review 时对 undefined 容错为 []）
  const lastRoundOutputs = new Map<string, Round1Output | Round2PlusOutput>();

  // executor resolve
  let executor: string | undefined;
  let executorMode: 'fixed' | 'rotate' | 'random' | 'per_scene' | undefined;
  let executorFallbackUsed = false;
  let originalExecutorModel: string | null = null;
  if (args.roles !== undefined) {
    try {
      const r = resolveExecutor({
        roles: args.roles,
        scene,
        participants: activeAgents,
        runUuid: ctx.runId,
        sceneName: a.sceneName,
        cliExecutorOverride: args.executorOverride,
      });
      executor = r.executor;
      executorMode = r.mode;
      executorFallbackUsed = r.fallbackUsed;
      originalExecutorModel = r.originalModel ?? null;
    } catch (err) {
      sm.transition(State.AbortNoParticipants);
      return abortResult(ctx, aggregator, a.language, (err as Error).message);
    }
  }

  const maxRounds = Math.min(
    scene.max_rounds,
    args.maxRoundsCap ?? scene.max_rounds,
  );

  let roundNum = 1;
  let finalKind: 'converged' | 'escaped' | null = null;

  while (roundNum <= maxRounds) {
    sm.transition(roundNum === 1 ? State.RoundRunning : State.RoundRunning);
    ctx.emit(EventType.RoundStarted, { active_agents: [...activeAgents] }, roundNum);

    // effortMap
    const effortMap = new Map<string, EffortLevel>();
    for (const name of activeAgents) {
      const modelCfg = args.enabledModels.get(name);
      effortMap.set(
        name,
        resolveEffort({
          cli: args.cliEffort,
          scene,
          modelConfig: { effort: modelCfg?.effort },
          modelName: name,
        }),
      );
    }

    const roundRes = await runRound({
      round: roundNum,
      activeAgents,
      adapters: args.adapters,
      effortMap,
      scene,
      enhancedQuestion,
      resolvedOutputLanguage: a.language.resolved_output,
      previousOutputs,
      timeoutMs: args.timeoutMs ?? 5 * 60 * 1000,
      // Round 1 注入 prior chain；Round 2+ 不需要（previousOutputs 已含 Round 1 上下文）
      priorChain: roundNum === 1 ? args.followupContext?.chain : undefined,
    });

    // 处理结果
    for (const r of roundRes.results) {
      if (r.ok) {
        ctx.emit(
          EventType.AgentResponded,
          {
            agent: r.agent,
            raw_head: r.output.answer.split('\n').slice(0, 3).join('\n'),
            output: r.output,
            duration_ms: r.durationMs,
          },
          roundNum,
        );
      } else {
        ctx.emit(EventType.AgentErrored, { agent: r.agent, error: r.error }, roundNum);
      }
    }

    ctx.emit(EventType.RoundCompleted, {}, roundNum);

    // 更新 blacklist
    blacklist.update(roundRes.results);
    activeAgents = blacklist.filterActive(activeAgents);

    // 收敛检查
    const agentStates = roundRes.results.map((r) => ({
      agent: r.agent,
      errored: !r.ok,
      output: r.ok && roundNum > 1 ? (r.output as Round2PlusOutput) : undefined,
    }));
    sm.transition(State.CheckingConvergence);
    const conv = checkConverged({
      currentRound: roundNum,
      scene: { min_rounds: scene.min_rounds, convergence_strictness: scene.convergence_strictness },
      agents: agentStates,
    });
    ctx.emit(EventType.ConvergenceChecked, { converged: conv.converged, reason: conv.reason }, roundNum);

    // 更新 previousOutputs（仅 ok 的）+ aggregator（来自 Codex review Bug #10 fix）
    for (const r of roundRes.results) {
      if (!r.ok) continue;
      previousOutputs.set(r.agent, r.output);
      // 记录 usage 到二维归档：[agent][round]
      aggregator.record(r.agent, roundNum, r.usage);
      // 任意轮次的成功输出都覆盖到 lastRoundOutputs；finalizer 读 .answer（Round1/Round2+ 同构）
      lastRoundOutputs.set(r.agent, r.output);
    }
    // ERRORED 的 agent 也记录 null usage，便于 history 显示完整 round 数
    for (const r of roundRes.results) {
      if (r.ok) continue;
      aggregator.record(r.agent, roundNum, null);
    }

    if (conv.converged) {
      finalKind = 'converged';
      sm.transition(State.FinalizingConverged);
      break;
    }

    // 检查 active < 2
    const check = checkActive({ active: activeAgents, path: 'multi_agent' });
    if (check.action === 'abort') {
      sm.transition(State.AbortNoParticipants);
      return abortResult(ctx, aggregator, a.language, check.reason);
    }

    roundNum++;
  }

  if (finalKind === null) {
    // 达到 maxRounds 未收敛
    finalKind = 'escaped';
    sm.transition(State.FinalizingEscaped);
  }

  const roundsCompleted = Math.min(roundNum, maxRounds);

  if (finalKind === 'converged' && executor !== undefined) {
    const execOutput = lastRoundOutputs.get(executor);
    if (execOutput === undefined) {
      // 收敛但 executor 输出缺失（极端情形）→ escaped
      finalKind = 'escaped';
    } else {
      const md = renderFinal({
        kind: 'converged',
        enhancedQuestion,
        executorOutput: execOutput,
        scene: a.sceneName,
        roundsCompleted,
        participants,
        executor,
        runId: ctx.runId,
        resolvedUiLanguage: a.language.resolved_ui,
        noPersist: args.noPersist === true,
      });
      sm.transition(State.Done);
      ctx.emit(EventType.FinalizedConverged, { markdown: md, executor });
      ctx.emit(EventType.Finalized, { outcome: 'converged' });
      return {
        kind: 'multi_agent_converged',
        finalMarkdown: md,
        runId: ctx.runId,
        language: a.language,
        usage: aggregator.build(),
        roundsCompleted,
        participants,
        executor,
        executorFallbackUsed,
        originalExecutorModel,
        scene: a.sceneName,
        sceneSource: a.sceneSource,
        sceneFallbackUsed: a.sceneFallbackUsed,
        enhancedQuestion,
        executorMode: executorMode ?? 'fixed',
      };
    }
  }

  // escaped path
  const md = renderFinal({
    kind: 'escaped',
    enhancedQuestion,
    agentOutputs: lastRoundOutputs,
    scene: a.sceneName,
    roundsCompleted,
    participants,
    runId: ctx.runId,
    resolvedUiLanguage: a.language.resolved_ui,
    noPersist: args.noPersist === true,
  });
  sm.transition(State.Done);
  ctx.emit(EventType.FinalizedEscaped, { markdown: md });
  ctx.emit(EventType.Finalized, { outcome: 'escaped' });
  return {
    kind: 'multi_agent_escaped',
    finalMarkdown: md,
    runId: ctx.runId,
    language: a.language,
    usage: aggregator.build(),
    roundsCompleted,
    participants,
    executor,
    executorFallbackUsed,
    originalExecutorModel,
    scene: a.sceneName,
    sceneSource: a.sceneSource,
    sceneFallbackUsed: a.sceneFallbackUsed,
    enhancedQuestion,
    executorMode: executorMode ?? 'fixed',
  };
}

// ─── 辅助：single-agent downgraded ───
interface DowngradedArgs {
  args: RunOrchestratorArgs;
  ctx: RunContext;
  sm: StateMachine;
  aggregator: UsageAggregator;
  language: LanguageState;
  scene: SceneConfig;
  sceneName: string;
  sceneSource: 'auto' | 'cli_override' | 'fallback_general';
  sceneFallbackUsed: boolean;
  participant: string;
  /** spec §roundtable-orchestrator: downgraded 路径用 enhanced_question 保留 Enhancer 上下文 */
  enhancedQuestion: string;
}

async function runSingleAgentDowngraded(p: DowngradedArgs): Promise<RunResult> {
  const { args, ctx, sm, aggregator, language, scene, sceneName, sceneSource, sceneFallbackUsed, participant, enhancedQuestion } = p;
  sm.transition(State.SingleAgentDowngradedInvoking);
  ctx.emit(EventType.SingleAgentStarted, { kind: 'downgraded', agent: participant });

  const adapter = args.adapters.get(participant);
  if (adapter === undefined) {
    sm.transition(State.AbortNoParticipants);
    return abortResult(ctx, aggregator, language, `adapter ${participant} not found`);
  }

  // spec §roundtable-orchestrator "单 agent 路径（两种进入方式共享行为）"：
  // downgraded 用 enhanced_question（保留 Enhancer 上下文）；direct 才用 raw_question
  const invocation = await invokeSingleAgent({
    question: enhancedQuestion,
    adapter,
    agentName: participant,
    scene,
    resolvedOutputLanguage: language.resolved_output,
    effort: args.defaultEffort,
    timeoutMs: args.timeoutMs ?? 5 * 60 * 1000,
    kind: 'downgraded',
  });

  if (!invocation.ok) {
    sm.transition(State.AbortNoParticipants);
    ctx.emit(EventType.AgentErrored, { agent: participant, error: invocation.error });
    return abortResult(ctx, aggregator, language, invocation.error);
  }
  aggregator.record(participant, 1, invocation.usage);
  ctx.emit(EventType.AgentResponded, {
    agent: participant,
    raw_head: invocation.output.answer.split('\n').slice(0, 3).join('\n'),
    usage: invocation.usage,
  });

  sm.transition(State.FinalizingSingle);
  const finalUi = finalizeUiLanguage({
    provisional_ui: language.resolved_ui,
    resolved_output: language.resolved_output,
    fallbackLang: 'en',
  });
  const finalLanguage: LanguageState = { ...language, resolved_ui: finalUi.resolved_ui };
  const md = renderFinal({
    kind: 'single_agent',
    question: enhancedQuestion, // downgraded 路径用 enhanced_question 作为 H1 来源
    output: invocation.output,
    agent: participant,
    scene: sceneName,
    runId: ctx.runId,
    resolvedUiLanguage: finalLanguage.resolved_ui,
    noPersist: args.noPersist === true,
    singleAgentKind: 'downgraded',
  });
  sm.transition(State.Done);
  ctx.emit(EventType.FinalizedSingleAgent, { markdown: md, agent: participant });
  ctx.emit(EventType.Finalized, { outcome: 'single_agent_completed' });

  return {
    kind: 'single_agent',
    finalMarkdown: md,
    runId: ctx.runId,
    language: finalLanguage,
    usage: aggregator.build(),
    roundsCompleted: 0,
    participants: [participant],
    scene: sceneName,
    sceneSource,
    sceneFallbackUsed,
    singleAgentKind: 'downgraded',
    enhancedQuestion, // Codex review Bug #9 fix: downgraded 路径 enhanced_question 持久化
  };
}

/**
 * 在 explicit 模式下提前 resolve language（供 Enhancer 使用）。
 *
 * auto 模式由 Enhancer 调用 resolveAutoOutput；本函数仅处理 explicit / system。
 */
function explicitPreResolved(args: RunOrchestratorArgs): LanguageState {
  if (args.requestedOutput === 'auto') return args.initialLanguage;
  const r = resolveExplicitOutput({
    request: { value: args.requestedOutput, origin: 'user_pref' },
    systemLang: args.initialLanguage.system,
  });
  return {
    ...args.initialLanguage,
    resolved_output: r.resolved,
    source: r.source,
  };
}

/** ALL_EVENTS re-export（便于测试订阅）。 */
export { ALL_EVENTS };

// Suppress unused warnings for utilities referenced in scaffolding
void resolveAutoOutput;
