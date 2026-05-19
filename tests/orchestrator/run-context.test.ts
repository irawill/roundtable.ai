import { describe, expect, it } from 'vitest';
import { RunContext } from '../../src/orchestrator/run-context.js';
import { EventType, type Event } from '../../src/shared/event-types.js';
import { isValidUuidV4 } from '../../src/shared/uuid.js';
import { ALL_EVENTS } from '../../src/shared/event-emitter.js';

describe('RunContext — 初始状态', () => {
  it('run_id 是合法 v4 UUID', () => {
    const ctx = new RunContext({ noPersist: false });
    expect(isValidUuidV4(ctx.runId)).toBe(true);
  });

  it('startedAt 是 ISO 8601', () => {
    const ctx = new RunContext({ noPersist: false });
    expect(new Date(ctx.startedAt).toString()).not.toBe('Invalid Date');
  });

  it('初始 isPersistable=false', () => {
    expect(new RunContext({ noPersist: false }).isPersistable()).toBe(false);
  });

  it('noPersist 透传', () => {
    expect(new RunContext({ noPersist: true }).noPersist).toBe(true);
  });
});

describe('RunContext — emit / buffer / drainBuffer', () => {
  it('confirmed=false 时 emit 累积到 buffer', () => {
    const ctx = new RunContext({ noPersist: false });
    ctx.emit(EventType.EnhancementStarted);
    ctx.emit(EventType.EnhancementCompleted);
    expect(ctx.drainBuffer()).toHaveLength(2);
  });

  it('emit 总是 emit 到 emitter（presenters 实时可见）', () => {
    const ctx = new RunContext({ noPersist: false });
    const received: Event[] = [];
    ctx.emitter.subscribe(ALL_EVENTS, (e) => received.push(e));
    ctx.emit(EventType.EnhancementStarted);
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe(EventType.EnhancementStarted);
  });

  it('markPersistable 后新事件不再累积到 buffer', () => {
    const ctx = new RunContext({ noPersist: false });
    ctx.emit(EventType.EnhancementStarted);
    ctx.markPersistable();
    ctx.drainBuffer(); // 清掉确认前的事件
    ctx.emit(EventType.RoundStarted, {}, 1);
    // round_started 不应在 buffer 里
    expect(ctx.drainBuffer()).toHaveLength(0);
  });

  it('drainBuffer 清空内部 buffer', () => {
    const ctx = new RunContext({ noPersist: false });
    ctx.emit(EventType.EnhancementStarted);
    expect(ctx.drainBuffer()).toHaveLength(1);
    expect(ctx.drainBuffer()).toHaveLength(0);
  });

  it('discard 清空 buffer（用户在确认页选 n）', () => {
    const ctx = new RunContext({ noPersist: false });
    ctx.emit(EventType.EnhancementStarted);
    ctx.discard();
    expect(ctx.drainBuffer()).toHaveLength(0);
  });

  it('emit 含 run_id 与 timestamp', () => {
    const ctx = new RunContext({ noPersist: false });
    const evt = ctx.emit(EventType.EnhancementStarted, { foo: 'bar' });
    expect(evt.run_id).toBe(ctx.runId);
    expect(evt.timestamp).toBeDefined();
    expect(evt.data).toEqual({ foo: 'bar' });
  });

  it('emit 含 round（可选）', () => {
    const ctx = new RunContext({ noPersist: false });
    const evt = ctx.emit(EventType.RoundStarted, {}, 2);
    expect(evt.round).toBe(2);
  });
});
