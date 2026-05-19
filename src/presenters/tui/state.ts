import type { EventEmitter } from '../../shared/event-emitter.js';
import { ALL_EVENTS } from '../../shared/event-emitter.js';
import { EventType, type Event } from '../../shared/event-types.js';
import type { Usage } from '../../shared/adapter.js';

/**
 * TUI 内部状态聚合器。
 *
 * 来自 §presenters "TUI presenter（默认开，--no-tui 关）" + tasks.md §13.1-§13.4。
 *
 * 设计：把事件总线的事件聚合为 TUI 渲染所需的状态对象；
 * UI 组件（阶段 6 的 ink 组件）订阅本聚合器的 snapshot 渲染。
 *
 * 这种解耦让 TUI 渲染 layer 不必直接订阅事件（更容易单测）。
 */

export type AgentStatus = 'idle' | 'thinking' | 'done' | 'errored';

export interface AgentDisplay {
  agent: string;
  status: AgentStatus;
  /** 当前 round 的回答（前若干行用于右侧展示） */
  currentRoundAnswerHead?: string;
  /** 当前轮已用 token cumulative */
  usage?: Usage | null;
  /** 上次错误（仅 status=errored 时填充） */
  lastError?: string;
}

export interface TuiSnapshot {
  /** 当前轮号（单 agent 路径为 1） */
  currentRound: number;
  /** 整个 run 的 max_rounds（用于 "Round 2/5" 显示） */
  maxRounds: number;
  /** 当前 scene */
  scene: string;
  /** 是否单 agent 路径 */
  isSingleAgent: boolean;
  /** 单 agent kind（仅 isSingleAgent=true 时） */
  singleAgentKind?: 'direct' | 'downgraded';
  /** 各 agent 显示状态 */
  agents: AgentDisplay[];
  /** 是否 --no-persist 模式（顶部横幅） */
  noPersist: boolean;
  /** 是否已收到 Enhancer 反问（含 questions） */
  enhancerQuestions?: string[];
  /** 是否在等用户确认 enhanced_question（Y/n/edit） */
  awaitingConfirmation?: { enhancedQuestion: string };
  /** 是否最终化（TUI 退出前最后一屏） */
  finalized: boolean;
  /** 单 agent / 多 agent 收敛 / escaped final markdown（最终一屏用） */
  finalMarkdown?: string;
  /** Web view URL（仅 web_view = print_url_only 时填） */
  webViewUrl?: string;
}

/**
 * TUI 状态聚合器：订阅事件总线 → 累积内部状态 → 提供 getSnapshot()。
 *
 * UI 组件用 setInterval 或事件回调拉取 snapshot 刷新。
 */
export class TuiStateAggregator {
  private snapshot: TuiSnapshot = {
    currentRound: 0,
    maxRounds: 0,
    scene: '(未确定)',
    isSingleAgent: false,
    agents: [],
    noPersist: false,
    finalized: false,
  };

  /** 订阅事件总线开始累积状态。返回 dispose 取消订阅。 */
  subscribe(emitter: EventEmitter): () => void {
    return emitter.subscribe(ALL_EVENTS, (evt: Event) => this.handle(evt));
  }

  /** 取当前快照（拷贝，不可变）。 */
  getSnapshot(): TuiSnapshot {
    return {
      ...this.snapshot,
      agents: this.snapshot.agents.map((a) => ({ ...a })),
    };
  }

  /** 直接 mutate snapshot（供调用方注入 noPersist / webViewUrl 等）。 */
  setStaticContext(ctx: Partial<Pick<TuiSnapshot, 'noPersist' | 'webViewUrl' | 'maxRounds'>>): void {
    this.snapshot = { ...this.snapshot, ...ctx };
  }

  private handle(evt: Event): void {
    switch (evt.type) {
      case EventType.EnhancementStarted:
        this.snapshot.scene = '(检测中...)';
        break;
      case EventType.EnhancementCompleted: {
        const data = evt.data as Record<string, unknown>;
        if (typeof data.scene === 'string') this.snapshot.scene = data.scene;
        if (Array.isArray(data.questions_for_user)) {
          this.snapshot.enhancerQuestions = (data.questions_for_user as unknown[]).map(String);
        }
        break;
      }
      case EventType.UserInputRequested: {
        const data = evt.data as Record<string, unknown>;
        if (typeof data.enhanced_question === 'string') {
          this.snapshot.awaitingConfirmation = { enhancedQuestion: data.enhanced_question };
        }
        break;
      }
      case EventType.UserInputReceived:
        this.snapshot.awaitingConfirmation = undefined;
        this.snapshot.enhancerQuestions = undefined;
        break;
      case EventType.RoundStarted: {
        const data = evt.data as Record<string, unknown>;
        this.snapshot.currentRound = evt.round ?? this.snapshot.currentRound;
        if (Array.isArray(data.active_agents)) {
          for (const name of data.active_agents as unknown[]) {
            const agentName = String(name);
            if (!this.snapshot.agents.find((a) => a.agent === agentName)) {
              this.snapshot.agents.push({ agent: agentName, status: 'idle' });
            }
            const a = this.snapshot.agents.find((x) => x.agent === agentName);
            if (a) a.status = 'thinking';
          }
        }
        break;
      }
      case EventType.AgentResponded: {
        const data = evt.data as Record<string, unknown>;
        const agentName = String(data.agent ?? '');
        const a = this.snapshot.agents.find((x) => x.agent === agentName);
        if (a) {
          a.status = 'done';
          if (typeof data.raw_head === 'string') a.currentRoundAnswerHead = data.raw_head;
          if (data.usage !== undefined) a.usage = data.usage as Usage | null;
        }
        break;
      }
      case EventType.AgentErrored: {
        const data = evt.data as Record<string, unknown>;
        const agentName = String(data.agent ?? '');
        const a = this.snapshot.agents.find((x) => x.agent === agentName);
        if (a) {
          a.status = 'errored';
          if (typeof data.error === 'string') a.lastError = data.error;
        }
        break;
      }
      case EventType.SingleAgentStarted: {
        const data = evt.data as Record<string, unknown>;
        this.snapshot.isSingleAgent = true;
        if (data.kind === 'direct' || data.kind === 'downgraded') {
          this.snapshot.singleAgentKind = data.kind;
        }
        if (typeof data.agent === 'string') {
          this.snapshot.agents = [{ agent: data.agent, status: 'thinking' }];
        }
        break;
      }
      case EventType.FinalizedConverged:
      case EventType.FinalizedEscaped:
      case EventType.FinalizedSingleAgent: {
        const data = evt.data as Record<string, unknown>;
        this.snapshot.finalized = true;
        if (typeof data.markdown === 'string') this.snapshot.finalMarkdown = data.markdown;
        break;
      }
      default:
        break;
    }
  }
}
