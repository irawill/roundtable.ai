import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../src/shared/event-emitter.js';
import { EventType, type Event } from '../../src/shared/event-types.js';
import { TuiStateAggregator, renderTuiFrame, renderTokenTicker } from '../../src/presenters/tui/index.js';

function makeEvent(
  type: EventType,
  data: Record<string, unknown> = {},
  round?: number,
): Event {
  return {
    type,
    timestamp: '2026-05-15T10:00:00.000Z',
    run_id: 'r1',
    ...(round !== undefined ? { round } : {}),
    data,
  };
}

describe('TuiStateAggregator — 事件聚合', () => {
  it('EnhancementCompleted 更新 scene + questions', () => {
    const emitter = new EventEmitter();
    const agg = new TuiStateAggregator();
    agg.subscribe(emitter);

    emitter.emit(
      makeEvent(EventType.EnhancementCompleted, {
        scene: 'consumer',
        questions_for_user: ['你的预算？'],
      }),
    );
    const snap = agg.getSnapshot();
    expect(snap.scene).toBe('consumer');
    expect(snap.enhancerQuestions).toEqual(['你的预算？']);
  });

  it('UserInputRequested → awaitingConfirmation；UserInputReceived → 清空', () => {
    const emitter = new EventEmitter();
    const agg = new TuiStateAggregator();
    agg.subscribe(emitter);

    emitter.emit(
      makeEvent(EventType.UserInputRequested, { enhanced_question: '推荐扫地机器人...' }),
    );
    expect(agg.getSnapshot().awaitingConfirmation?.enhancedQuestion).toContain('推荐扫地机器人');

    emitter.emit(makeEvent(EventType.UserInputReceived));
    expect(agg.getSnapshot().awaitingConfirmation).toBeUndefined();
  });

  it('RoundStarted + AgentResponded → agent 状态从 thinking → done', () => {
    const emitter = new EventEmitter();
    const agg = new TuiStateAggregator();
    agg.subscribe(emitter);

    emitter.emit(makeEvent(EventType.RoundStarted, { active_agents: ['claude', 'codex'] }, 1));
    let snap = agg.getSnapshot();
    expect(snap.currentRound).toBe(1);
    expect(snap.agents.find((a) => a.agent === 'claude')?.status).toBe('thinking');

    emitter.emit(
      makeEvent(
        EventType.AgentResponded,
        { agent: 'claude', raw_head: 'answer head', usage: { input_tokens: 100, output_tokens: 50 } },
        1,
      ),
    );
    snap = agg.getSnapshot();
    expect(snap.agents.find((a) => a.agent === 'claude')?.status).toBe('done');
    expect(snap.agents.find((a) => a.agent === 'claude')?.currentRoundAnswerHead).toBe('answer head');
  });

  it('AgentErrored → status=errored + lastError', () => {
    const emitter = new EventEmitter();
    const agg = new TuiStateAggregator();
    agg.subscribe(emitter);
    emitter.emit(makeEvent(EventType.RoundStarted, { active_agents: ['a'] }, 1));
    emitter.emit(makeEvent(EventType.AgentErrored, { agent: 'a', error: 'timeout' }, 1));
    const snap = agg.getSnapshot();
    expect(snap.agents[0]!.status).toBe('errored');
    expect(snap.agents[0]!.lastError).toBe('timeout');
  });

  it('SingleAgentStarted → isSingleAgent + kind + agent', () => {
    const emitter = new EventEmitter();
    const agg = new TuiStateAggregator();
    agg.subscribe(emitter);
    emitter.emit(makeEvent(EventType.SingleAgentStarted, { kind: 'direct', agent: 'claude' }));
    const snap = agg.getSnapshot();
    expect(snap.isSingleAgent).toBe(true);
    expect(snap.singleAgentKind).toBe('direct');
    expect(snap.agents[0]?.agent).toBe('claude');
  });

  it('FinalizedConverged → finalized=true + finalMarkdown', () => {
    const emitter = new EventEmitter();
    const agg = new TuiStateAggregator();
    agg.subscribe(emitter);
    emitter.emit(makeEvent(EventType.FinalizedConverged, { markdown: '# Final' }));
    const snap = agg.getSnapshot();
    expect(snap.finalized).toBe(true);
    expect(snap.finalMarkdown).toBe('# Final');
  });

  it('setStaticContext 注入 noPersist / webViewUrl / maxRounds', () => {
    const agg = new TuiStateAggregator();
    agg.setStaticContext({
      noPersist: true,
      webViewUrl: 'http://localhost:7421',
      maxRounds: 5,
    });
    const snap = agg.getSnapshot();
    expect(snap.noPersist).toBe(true);
    expect(snap.webViewUrl).toBe('http://localhost:7421');
    expect(snap.maxRounds).toBe(5);
  });
});

describe('renderTuiFrame', () => {
  it('单 agent direct 模式渲染', () => {
    const agg = new TuiStateAggregator();
    agg.setStaticContext({ noPersist: false });
    const emitter = new EventEmitter();
    agg.subscribe(emitter);
    emitter.emit(makeEvent(EventType.SingleAgentStarted, { kind: 'direct', agent: 'claude' }));
    const out = renderTuiFrame({ snapshot: agg.getSnapshot(), resolvedUiLanguage: 'zh-Hans' });
    expect(out).toContain('single agent (direct)');
    expect(out).toContain('claude');
  });

  it('多 agent + maxRounds → Round X/Y 显示', () => {
    const agg = new TuiStateAggregator();
    agg.setStaticContext({ maxRounds: 5 });
    const emitter = new EventEmitter();
    agg.subscribe(emitter);
    emitter.emit(makeEvent(EventType.RoundStarted, { active_agents: ['a', 'b'] }, 2));
    const out = renderTuiFrame({ snapshot: agg.getSnapshot(), resolvedUiLanguage: 'en' });
    expect(out).toContain('Round 2/5');
  });

  it('--no-persist 顶部横幅渲染（中文）', () => {
    const agg = new TuiStateAggregator();
    agg.setStaticContext({ noPersist: true });
    const out = renderTuiFrame({ snapshot: agg.getSnapshot(), resolvedUiLanguage: 'zh-Hans' });
    expect(out).toContain('🚫');
    expect(out).toContain('--no-persist');
  });

  it('Web view URL 顶部状态栏渲染', () => {
    const agg = new TuiStateAggregator();
    agg.setStaticContext({ webViewUrl: 'http://localhost:7421' });
    const out = renderTuiFrame({ snapshot: agg.getSnapshot(), resolvedUiLanguage: 'en' });
    expect(out).toContain('Live view: http://localhost:7421');
  });

  it('agent 状态图标渲染', () => {
    const agg = new TuiStateAggregator();
    const emitter = new EventEmitter();
    agg.subscribe(emitter);
    emitter.emit(makeEvent(EventType.RoundStarted, { active_agents: ['claude', 'codex', 'gemini'] }, 1));
    emitter.emit(makeEvent(EventType.AgentResponded, { agent: 'claude' }, 1));
    emitter.emit(makeEvent(EventType.AgentErrored, { agent: 'gemini', error: 'timeout' }, 1));
    const out = renderTuiFrame({ snapshot: agg.getSnapshot(), resolvedUiLanguage: 'en' });
    expect(out).toContain('✔ claude');
    expect(out).toContain('⠋ codex');
    expect(out).toContain('✗ gemini');
  });

  it('Enhancer 反问与确认页', () => {
    const agg = new TuiStateAggregator();
    const emitter = new EventEmitter();
    agg.subscribe(emitter);
    emitter.emit(
      makeEvent(EventType.EnhancementCompleted, {
        scene: 'consumer',
        questions_for_user: ['Q1', 'Q2'],
      }),
    );
    emitter.emit(
      makeEvent(EventType.UserInputRequested, { enhanced_question: '推荐扫地机器人（家用清洁）' }),
    );
    const out = renderTuiFrame({ snapshot: agg.getSnapshot(), resolvedUiLanguage: 'zh-Hans' });
    expect(out).toContain('Q1');
    expect(out).toContain('Q2');
    expect(out).toContain('继续 (Y)');
  });
});

describe('renderTokenTicker', () => {
  it('累加 + total', () => {
    const out = renderTokenTicker([
      {
        agent: 'claude',
        status: 'done',
        usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 30 },
      },
      { agent: 'codex', status: 'done', usage: { input_tokens: 200, output_tokens: 80 } },
    ]);
    expect(out).toContain('claude=180');
    expect(out).toContain('codex=280');
    expect(out).toContain('total=460');
  });

  it('null usage 显示 -；total 跳过 null', () => {
    const out = renderTokenTicker([
      { agent: 'claude', status: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
      { agent: 'gemini', status: 'done', usage: null },
    ]);
    expect(out).toContain('claude=150');
    expect(out).toContain('gemini=-');
    expect(out).toContain('total=150');
  });

  it('provisional 加 ~ 前缀', () => {
    const out = renderTokenTicker([
      {
        agent: 'gemini',
        status: 'thinking',
        usage: { input_tokens: 100, output_tokens: 50, provisional: true },
      },
    ]);
    expect(out).toContain('gemini=~150');
  });
});
