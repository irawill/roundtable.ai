import type { EventEmitter } from '../shared/event-emitter.js';
import { ALL_EVENTS } from '../shared/event-emitter.js';
import { EventType, type Event } from '../shared/event-types.js';

/**
 * stdout / stderr presenter。
 *
 * 来自 §presenters "stdout 仅输出 final；进度走 TUI 或 stderr" + "verbosity 三档"
 * + tasks.md §12.1-§12.7 + 跨阶段约束 #11 关于"stdout 永远只承载 final.md"。
 *
 * 不变量（**绝对约束**）：
 * - stdout **始终仅在 run 完成后输出 final.md**（无论 TUI on/off / verbosity）
 * - `rtai "..." > out.md` 在任何配置下 out.md 都只有 final.md，**不**被进度行污染
 *
 * 分流：
 * - TUI on（默认）：中间进度走 TUI；stdout 在 TUI 退出后一次性输出 final.md
 * - TUI off / --no-tui：中间进度走 **stderr**；stdout 仍仅 final.md
 *
 * verbosity（仅影响 TUI 与 stderr）：
 * - quiet：仅 errors + final 完成提示
 * - normal（默认）：scene + active agents 启动信息 + 每 round 1 行 summary
 * - verbose：每 round 额外每 agent raw stdout 前 N 行
 */

export type Verbosity = 'quiet' | 'normal' | 'verbose';

export interface StdoutPresenterArgs {
  /** 事件总线 */
  emitter: EventEmitter;
  /** TUI on/off（影响中间进度走向） */
  tuiOn: boolean;
  /** verbosity 三档 */
  verbosity: Verbosity;
  /** --no-persist 启用时为 true（控制启动信息提示） */
  noPersist?: boolean;
  /** stdout write fn；默认 process.stdout.write */
  stdout?: (s: string) => void;
  /** stderr write fn；默认 process.stderr.write */
  stderr?: (s: string) => void;
}

/**
 * 启动 stdout presenter。返回 dispose 函数（取消订阅）。
 *
 * 行为：
 * - 订阅事件总线
 * - 中间进度按 tuiOn / verbosity 决定写到 stdout / stderr / 静默
 * - finalized_* 事件：从 data.markdown 取 final.md 内容 → 写入 stdout（一次性）
 */
export function startStdoutPresenter(args: StdoutPresenterArgs): () => void {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  const writeProgress = (line: string): void => {
    if (args.tuiOn) return; // TUI on 时进度走 TUI，不写 stderr
    stderr(line + '\n');
  };

  // --no-persist 启动信息（TUI off 时；TUI on 由 TUI 顶部状态栏展示）
  if (args.noPersist === true && !args.tuiOn) {
    stderr('[--no-persist] events / final.md will NOT be written to disk.\n');
  }

  const dispose = args.emitter.subscribe(ALL_EVENTS, (evt: Event) => {
    handleEvent(evt, args.verbosity, stdout, writeProgress);
  });

  return dispose;
}

function handleEvent(
  evt: Event,
  verbosity: Verbosity,
  stdout: (s: string) => void,
  writeProgress: (line: string) => void,
): void {
  // 任何 verbosity / TUI 配置下，finalized_* 都把 final.md 写到 stdout
  if (
    evt.type === EventType.FinalizedConverged ||
    evt.type === EventType.FinalizedEscaped ||
    evt.type === EventType.FinalizedSingleAgent
  ) {
    const data = evt.data as Record<string, unknown>;
    const markdown = data.markdown as string | undefined;
    if (typeof markdown === 'string' && markdown.length > 0) {
      stdout(markdown);
      if (!markdown.endsWith('\n')) stdout('\n');
    }
    return;
  }

  // 进度事件按 verbosity 分流
  if (verbosity === 'quiet') {
    // quiet：仅在 errors / abort 时输出
    if (evt.type === EventType.AgentErrored) {
      const data = evt.data as Record<string, unknown>;
      writeProgress(`✗ agent_errored: ${String(data.agent ?? '?')} round ${evt.round ?? '?'} — ${String(data.error ?? '')}`);
    }
    if (evt.type === EventType.Finalized) {
      const data = evt.data as Record<string, unknown>;
      if (data.outcome === 'aborted' || data.outcome === 'cancelled') {
        writeProgress(`run ${evt.run_id} ${String(data.outcome)}`);
      }
    }
    return;
  }

  // normal + verbose：基础进度
  switch (evt.type) {
    case EventType.EnhancementStarted:
      writeProgress('· Enhancer working...');
      break;
    case EventType.EnhancementCompleted: {
      const data = evt.data as Record<string, unknown>;
      if (data.fallback_used === true) {
        writeProgress(`⚠ Enhancer fallback used (${String(data.failure_reason ?? 'unknown')})`);
      } else {
        writeProgress(
          `✓ Enhancer done: scene=${String(data.scene ?? '?')} (source=${String(data.scene_source ?? '?')})`,
        );
      }
      break;
    }
    case EventType.UserInputRequested: {
      const data = evt.data as Record<string, unknown>;
      writeProgress(`? ${String(data.prompt ?? 'awaiting user input')}`);
      break;
    }
    case EventType.RoundStarted: {
      const data = evt.data as Record<string, unknown>;
      const active = data.active_agents;
      const agentList: string[] = Array.isArray(active)
        ? (active as string[])
        : typeof active === 'string'
          ? active.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
          : [];
      writeProgress(`→ Round ${evt.round ?? '?'} start (active: ${agentList.join(', ') || '?'})`);
      // 每个 agent 单独一行 "thinking…"，给用户视觉反馈："3 个 agent 并行干活中"
      // 而不是 round_started 后空白 30-60s。完成时再 print "✓ agent round N"。
      for (const a of agentList) writeProgress(`  · ${a} thinking…`);
      break;
    }
    case EventType.AgentResponded: {
      const data = evt.data as Record<string, unknown>;
      if (verbosity === 'verbose') {
        const rawHead = String(data.raw_head ?? '').slice(0, 200);
        writeProgress(`  ✓ ${String(data.agent ?? '?')} round ${evt.round ?? '?'} (${String(data.duration_ms ?? '?')}ms)\n    ${rawHead}`);
      } else {
        writeProgress(`  ✓ ${String(data.agent ?? '?')} round ${evt.round ?? '?'}`);
      }
      break;
    }
    case EventType.AgentErrored: {
      const data = evt.data as Record<string, unknown>;
      writeProgress(`  ✗ ${String(data.agent ?? '?')} round ${evt.round ?? '?'} — ${String(data.error ?? '')}`);
      break;
    }
    case EventType.RoundCompleted: {
      const data = evt.data as Record<string, unknown>;
      const stab = data.stability_summary as string | undefined;
      writeProgress(`← Round ${evt.round ?? '?'} done${stab ? `: ${stab}` : ''}`);
      break;
    }
    case EventType.ConvergenceChecked: {
      const data = evt.data as Record<string, unknown>;
      if (data.converged === true) {
        writeProgress(`✓ Converged at round ${evt.round ?? '?'}`);
      } else if (verbosity === 'verbose') {
        writeProgress(`  ↻ not yet (${String(data.reason ?? '?')})`);
      }
      break;
    }
    case EventType.SingleAgentStarted: {
      const data = evt.data as Record<string, unknown>;
      writeProgress(`· single agent (${String(data.kind ?? '?')}) starting...`);
      break;
    }
    case EventType.Finalized: {
      const data = evt.data as Record<string, unknown>;
      const outcome = String(data.outcome ?? '?');
      if (outcome === 'aborted' || outcome === 'cancelled') {
        writeProgress(`run ${evt.run_id} ${outcome}`);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * 启动信息（normal / verbose 时打印）。
 *
 * 调用方在 Orchestrator 决定 scene + active agents 后调用。
 */
export function emitStartupInfo(args: {
  emitter: EventEmitter;
  tuiOn: boolean;
  verbosity: Verbosity;
  scene: string;
  activeAgents: readonly string[];
  stderr?: (s: string) => void;
}): void {
  if (args.verbosity === 'quiet') return;
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));
  if (args.tuiOn) return; // TUI on 时由 TUI 顶部状态栏渲染
  stderr(`scene = ${args.scene} | active agents = [${args.activeAgents.join(', ')}]\n`);
}
