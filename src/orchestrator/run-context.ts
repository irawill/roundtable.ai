import { type Event, EventType } from '../shared/event-types.js';
import { EventEmitter } from '../shared/event-emitter.js';
import { uuidv4 } from '../shared/uuid.js';
import { nowIso } from '../shared/time.js';

/**
 * Run 上下文：run_id + 内存 events buffer + 持久化时机控制。
 *
 * 来自 §roundtable-orchestrator + §persistence-history "Run 目录持久化时机"
 * + tasks.md §8.5 + 跨阶段约束 #11。
 *
 * 持久化时机：
 * - 多 agent 路径 + 单 agent downgraded 路径：runs/<run_id>/ 在用户确认 enhanced_question
 *   选 Y/edit 时**才**创建；之前的事件保存在内存 buffer，确认后批量回填到 events.jsonl
 * - 单 agent direct 路径：进入 SINGLE_AGENT_DIRECT_INVOKING 状态时**立即**创建目录
 * - **--no-persist** 全局覆盖：任何路径下 MUST NOT 创建目录
 *
 * 用户在确认页选 n → 丢弃内存 buffer，不创建任何文件
 * Enhancer 阶段崩溃 / Ctrl-C → 内存事件已积累但未落盘 → 不创建目录
 */

export interface RunContextOptions {
  /** --no-persist 启用时为 true */
  noPersist: boolean;
  /** 注入 emitter；默认创建新实例 */
  emitter?: EventEmitter;
}

/**
 * Run 生命周期上下文。
 *
 * 用法：Orchestrator 入口 new RunContext({ noPersist }) → 各阶段通过 emit() 发事件 →
 * 用户确认时 markPersistable() → 持久化层订阅 emitter，且在 markPersistable() 后批量回填
 * 之前在 buffer 中收集的事件。
 */
export class RunContext {
  /** v4 UUID，启动时立即生成于内存 */
  readonly runId: string;
  /** --no-persist 标志 */
  readonly noPersist: boolean;
  /** 事件总线 */
  readonly emitter: EventEmitter;
  /** 启动时间戳 */
  readonly startedAt: string;

  /**
   * 内存 events buffer：仅在 confirmed=false 期间累积事件；
   * 用户确认后调 markPersistable() 把 buffer 标为 readyToFlush，由外部持久化层批量回填。
   */
  private buffer: Event[] = [];
  /** 用户确认（多 agent + downgraded 路径）或进入 direct 路径后变 true */
  private persistable = false;

  constructor(opts: RunContextOptions = { noPersist: false }) {
    this.runId = uuidv4();
    this.noPersist = opts.noPersist;
    this.emitter = opts.emitter ?? new EventEmitter();
    this.startedAt = nowIso();
  }

  /**
   * 发出事件：
   * - 永远先 emit 到 emitter（presenters 等订阅方都能收到）
   * - confirmed=false 时同时累积到内存 buffer（待批量回填）
   * - persistable=true 后**不再**累积（持久化层会订阅 emitter 实时写）
   *
   * 这种设计让 presenters / 落盘层解耦：presenters 不关心是否持久化，
   * 落盘层在 markPersistable() 后既能拿到 buffer 也能继续订阅。
   */
  emit(type: EventType, data: Record<string, unknown> = {}, round?: number): Event {
    const event: Event = {
      type,
      timestamp: nowIso(),
      run_id: this.runId,
      ...(round !== undefined ? { round } : {}),
      data,
    };
    if (!this.persistable) this.buffer.push(event);
    this.emitter.emit(event);
    return event;
  }

  /**
   * 标记可以开始持久化。
   *
   * 调用时机：
   * - 多 agent / downgraded 路径：用户在 enhanced_question 确认页选 Y / edit
   * - 单 agent direct 路径：进入 SINGLE_AGENT_DIRECT_INVOKING 状态
   *
   * --no-persist 模式下也可以调用，但持久化层订阅会跳过写盘。
   */
  markPersistable(): void {
    this.persistable = true;
  }

  /** 取已累积的 buffer 副本（供持久化层批量回填）。 */
  drainBuffer(): Event[] {
    const out = this.buffer.slice();
    this.buffer = [];
    return out;
  }

  isPersistable(): boolean {
    return this.persistable;
  }

  /** Cancelled 路径丢弃 buffer 与 run_id。 */
  discard(): void {
    this.buffer = [];
  }
}
