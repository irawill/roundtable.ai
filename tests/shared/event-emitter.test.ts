import { describe, expect, it, vi } from 'vitest';
import { ALL_EVENTS, EventEmitter } from '../../src/shared/event-emitter.js';
import { EventType, type Event } from '../../src/shared/event-types.js';

function makeEvent(type: EventType, run_id = 'r1'): Event {
  return {
    type,
    timestamp: '2026-05-14T00:00:00.000Z',
    run_id,
    data: {},
  };
}

describe('EventEmitter', () => {
  it('派发给指定 EventType 的订阅', () => {
    const bus = new EventEmitter();
    const spy = vi.fn();
    bus.subscribe(EventType.RoundStarted, spy);

    const evt = makeEvent(EventType.RoundStarted);
    bus.emit(evt);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(evt);
  });

  it('不派发给不匹配的 EventType 订阅', () => {
    const bus = new EventEmitter();
    const spy = vi.fn();
    bus.subscribe(EventType.RoundStarted, spy);

    bus.emit(makeEvent(EventType.EnhancementStarted));

    expect(spy).not.toHaveBeenCalled();
  });

  it('ALL_EVENTS 订阅收到任意事件', () => {
    const bus = new EventEmitter();
    const spy = vi.fn();
    bus.subscribe(ALL_EVENTS, spy);

    bus.emit(makeEvent(EventType.RoundStarted));
    bus.emit(makeEvent(EventType.Finalized));

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('once 订阅在首次匹配后自动 unsubscribe', () => {
    const bus = new EventEmitter();
    const spy = vi.fn();
    bus.once(EventType.RoundStarted, spy);

    bus.emit(makeEvent(EventType.RoundStarted));
    bus.emit(makeEvent(EventType.RoundStarted));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount()).toBe(0);
  });

  it('subscribe 返回的 unsubscribe 句柄能取消订阅', () => {
    const bus = new EventEmitter();
    const spy = vi.fn();
    const off = bus.subscribe(EventType.RoundStarted, spy);

    off();
    bus.emit(makeEvent(EventType.RoundStarted));

    expect(spy).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  it('unsubscribe(key, listener) 能取消订阅', () => {
    const bus = new EventEmitter();
    const spy = vi.fn();
    bus.subscribe(EventType.RoundStarted, spy);

    bus.unsubscribe(EventType.RoundStarted, spy);
    bus.emit(makeEvent(EventType.RoundStarted));

    expect(spy).not.toHaveBeenCalled();
  });

  it('多 listener 按订阅顺序触发', () => {
    const bus = new EventEmitter();
    const order: string[] = [];
    bus.subscribe(EventType.RoundStarted, () => order.push('a'));
    bus.subscribe(EventType.RoundStarted, () => order.push('b'));
    bus.subscribe(EventType.RoundStarted, () => order.push('c'));

    bus.emit(makeEvent(EventType.RoundStarted));

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('单个 listener throw MUST NOT 中断其他 listener', () => {
    const bus = new EventEmitter();
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = vi.fn(() => {
      throw new Error('boom');
    });
    const b = vi.fn();
    bus.subscribe(EventType.RoundStarted, a);
    bus.subscribe(EventType.RoundStarted, b);

    expect(() => bus.emit(makeEvent(EventType.RoundStarted))).not.toThrow();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('listener 在回调里修改订阅列表不影响当前迭代', () => {
    const bus = new EventEmitter();
    const calls: string[] = [];
    bus.subscribe(EventType.RoundStarted, () => {
      calls.push('a');
      bus.subscribe(EventType.RoundStarted, () => calls.push('c-added-during-emit'));
    });
    bus.subscribe(EventType.RoundStarted, () => calls.push('b'));

    bus.emit(makeEvent(EventType.RoundStarted));

    // 当前 emit 仅触发 snapshot 中的 a, b；新增的 c 在下次 emit 才生效
    expect(calls).toEqual(['a', 'b']);

    bus.emit(makeEvent(EventType.RoundStarted));
    // 第二次 emit：a → 再加一个 c, b, 上一次加的 c
    expect(calls.filter((x) => x === 'c-added-during-emit').length).toBeGreaterThanOrEqual(1);
  });
});
