import type { Event, EventType } from './event-types.js';

/**
 * Listener 签名：接收 Event，无返回值。
 *
 * subscribe / once 可同时接收：(a) 任意类型订阅 EventType.AllEvents（用 'all' 字符串）；
 * (b) 指定 EventType 订阅。Orchestrator 同时持有 unsubscribe 句柄。
 */
export type EventListener = (event: Event) => void;

/** 表示"订阅一切"的特殊键；用 const 字符串避免与 EventType 字面冲突。 */
export const ALL_EVENTS = '__rtai_all_events__' as const;
export type SubscribeKey = EventType | typeof ALL_EVENTS;

interface Subscription {
  /** 注册时的事件类型（含 'all'） */
  key: SubscribeKey;
  /** 实际 listener；once 模式下经过包装 */
  listener: EventListener;
  /** 一次性订阅标志（once 模式 emit 后自动 unsubscribe） */
  once: boolean;
}

/**
 * 轻量 EventEmitter（pub-sub），无 RxJS / EventEmitter3 等重依赖。
 *
 * 设计约定（来自 §presenters "事件总线驱动" + 跨阶段约束 #10 事件所有权）：
 * - presenters / Orchestrator 内部均订阅同一实例
 * - 同步派发（emit 完成时所有 listener 都已调用），保证 events.jsonl 写入顺序与 emit 顺序一致
 * - 单个 listener 异常 MUST NOT 阻断其他 listener；emit 捕获每个 listener 的 throw 写到 stderr
 */
export class EventEmitter {
  private subs: Subscription[] = [];

  /**
   * 订阅事件。返回的句柄是 unsubscribe 函数（也可通过 unsubscribe(handle) 取消）。
   *
   * @param key  EventType 或 ALL_EVENTS（订阅全部）
   * @param listener  回调函数
   */
  subscribe(key: SubscribeKey, listener: EventListener): () => void {
    const sub: Subscription = { key, listener, once: false };
    this.subs.push(sub);
    return () => this.removeSubscription(sub);
  }

  /**
   * 一次性订阅：第一次匹配事件触发后自动 unsubscribe。
   */
  once(key: SubscribeKey, listener: EventListener): () => void {
    const sub: Subscription = { key, listener, once: true };
    this.subs.push(sub);
    return () => this.removeSubscription(sub);
  }

  /**
   * 取消订阅。建议直接用 subscribe / once 返回的句柄；本方法是后备入口。
   */
  unsubscribe(key: SubscribeKey, listener: EventListener): void {
    this.subs = this.subs.filter((s) => !(s.key === key && s.listener === listener));
  }

  /**
   * 派发事件给所有匹配 subscriber（同步）。
   *
   * - 单个 listener throw MUST NOT 中断后续 listener；异常写到 stderr 但不上抛
   * - once 模式 listener 在调用后立即 unsubscribe
   * - 派发顺序：按订阅注册顺序（先订阅先调用）
   */
  emit(event: Event): void {
    // 拷贝一份避免 listener 在回调里修改订阅列表导致迭代乱
    const snapshot = this.subs.slice();
    const toRemove: Subscription[] = [];

    for (const sub of snapshot) {
      if (sub.key !== ALL_EVENTS && sub.key !== event.type) continue;
      try {
        sub.listener(event);
      } catch (err) {
        // 单个 listener 异常不阻塞其他；写到 stderr 但 emit 本身不上抛
        // eslint-disable-next-line no-console
        console.error(
          `[EventEmitter] listener for "${String(sub.key)}" threw:`,
          err instanceof Error ? err.stack ?? err.message : err,
        );
      }
      if (sub.once) toRemove.push(sub);
    }

    if (toRemove.length > 0) {
      this.subs = this.subs.filter((s) => !toRemove.includes(s));
    }
  }

  /** 仅测试 / debug 用：当前订阅数量（含 once）。 */
  listenerCount(): number {
    return this.subs.length;
  }

  /** 仅测试 / debug 用：清空所有订阅。 */
  clear(): void {
    this.subs = [];
  }

  private removeSubscription(sub: Subscription): void {
    this.subs = this.subs.filter((s) => s !== sub);
  }
}
