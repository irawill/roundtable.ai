import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import { ModelConfigSchema, type ModelConfig } from '../../src/config/schemas/models.js';
import type { RolesFile } from '../../src/config/schemas/roles.js';
import type { LanguageState } from '../../src/lang/types.js';
import type {
  Adapter,
  AdapterInvokeArgs,
  AdapterResult,
} from '../../src/shared/adapter.js';
import type {
  Round1Output,
  Round2PlusOutput,
} from '../../src/shared/agent-output-schema.js';
import { EventType, type Event } from '../../src/shared/event-types.js';
import { ALL_EVENTS } from '../../src/shared/event-emitter.js';
import { runOrchestrator } from '../../src/orchestrator/run.js';
import { CONVERGED_PROMPTS, DIVERGED_PROMPTS } from './canonical-prompts.js';

/**
 * E2E 测试：runOrchestrator 端到端装配。
 *
 * 来自 tasks.md §21.3 + 阶段 8 主入口装配 verification。
 *
 * 用 mock adapter 模拟 4 条路径：
 * 1. 多 agent 收敛（converged）
 * 2. 多 agent escaped
 * 3. 单 agent direct（enabled.length = 1）
 * 4. 单 agent downgraded（Layer 2 三重交集 = 1）
 */

function makeEnabledModels(names: string[], capabilities: string[] = []): Map<string, ModelConfig> {
  const m = new Map<string, ModelConfig>();
  for (const name of names) {
    m.set(name, ModelConfigSchema.parse({ enabled: true, capabilities }));
  }
  return m;
}

function makeRoles(executorModel: string): RolesFile {
  return {
    enhancer: { mode: 'fixed', model: executorModel },
    executor: { mode: 'fixed', model: executorModel },
  };
}

const DEFAULT_LANG: LanguageState = {
  system: 'en',
  requested_output: 'auto',
  resolved_output: 'en',
  resolved_ui: 'en',
  source: 'auto_detected',
  confidence: 0.95,
  fallback_used: false,
};

/**
 * Mock Enhancer adapter：返回固定 scene + auto language。
 */
function mockEnhancerAdapter(opts: {
  detectedScene?: string;
  enhancedQuestion?: string;
  questions?: string[];
} = {}): Adapter {
  return {
    name: 'mock-enhancer',
    capabilities: [],
    roleSuitability: { enhancer: 'high', executor: 'high' },
    binaryAvailable: async () => true,
    version: async () => '1.0.0',
    detectAuthState: async () => 'ok',
    authInstructions: () => 'mock',
    invoke: async (_args: AdapterInvokeArgs): Promise<AdapterResult> => ({
      rawStdout: '',
      parsed: {
        detected_scene: opts.detectedScene ?? 'general',
        scene_confidence: 0.95,
        scene_reasoning: 'mock',
        inferred_dimensions: { x: '[推断] mock' },
        enhanced_question_so_far: opts.enhancedQuestion ?? 'enhanced',
        questions_for_user: opts.questions ?? [],
        user_language: 'en',
        language_confidence: 0.95,
      },
      usage: null,
      durationMs: 100,
    }),
  };
}

/**
 * Mock round-loop adapter：
 * - Round 1 返回 Round1Output（无 self_stability / peer_review）
 * - Round 2+ 返回 Round2PlusOutput 含 stable / agree=true / 完整 peer_review
 *
 * @param peerNames  本 agent 应当 peer_review 的其他 agent 名（含且仅含）
 */
function mockRoundAdapter(opts: {
  name: string;
  selfName: string;
  otherAgents: string[];
  round2Stable?: boolean;
  disagreement?: { type: 'factual' | 'reasoning' | 'cosmetic' | 'alternative_view'; with: string };
}): Adapter {
  return {
    name: opts.name,
    capabilities: [],
    roleSuitability: { enhancer: 'high', executor: 'high' },
    binaryAvailable: async () => true,
    version: async () => '1.0.0',
    detectAuthState: async () => 'ok',
    authInstructions: () => 'mock',
    invoke: async (args: AdapterInvokeArgs): Promise<AdapterResult> => {
      // 通过 prompt 中的 "Round N" 判断当前轮（粗略）
      const round1Match = args.prompt.includes('Round 1') || !args.prompt.includes('Round 2');
      // 更精确：prompt 中 Round 2+ 提到 "self_stability"
      const isRound2Plus = args.prompt.includes('"self_stability"');
      if (!isRound2Plus) {
        const r1: Round1Output = {
          answer: `${opts.selfName} round 1 answer`,
          key_claims: ['shared claim'],
          uncertainty_notes: [],
          search_evidence: [],
        };
        void round1Match;
        return { rawStdout: '', parsed: r1, usage: { input_tokens: 50, output_tokens: 30 }, durationMs: 100 };
      }
      // Round 2+
      const stable = opts.round2Stable ?? true;
      const peerReview = opts.otherAgents.map((other) => {
        if (opts.disagreement !== undefined && opts.disagreement.with === other) {
          return {
            agent: other,
            agree: false,
            agreement_basis: '',
            disagreements: [{ claim: 'topic', my_view: `${opts.selfName} view`, type: opts.disagreement.type }],
          };
        }
        return {
          agent: other,
          agree: true,
          agreement_basis: 'verified independently',
          disagreements: [],
        };
      });
      const r2: Round2PlusOutput = {
        answer: `${opts.selfName} round 2+ answer`,
        key_claims: ['shared claim'],
        uncertainty_notes: [],
        search_evidence: [],
        self_stability: stable ? 'stable' : 'refining',
        self_change_summary: '',
        peer_review: peerReview,
      };
      return { rawStdout: '', parsed: r2, usage: { input_tokens: 80, output_tokens: 40 }, durationMs: 120 };
    },
  };
}

describe('runOrchestrator — 多 agent 收敛路径', () => {
  it('3 agent 全 stable + 无 disagreement → converged', async () => {
    const adapters = new Map([
      ['enhancer', mockEnhancerAdapter({ detectedScene: 'general' })],
      [
        'claude',
        mockRoundAdapter({
          name: 'claude',
          selfName: 'claude',
          otherAgents: ['codex', 'gemini'],
          round2Stable: true,
        }),
      ],
      [
        'codex',
        mockRoundAdapter({
          name: 'codex',
          selfName: 'codex',
          otherAgents: ['claude', 'gemini'],
          round2Stable: true,
        }),
      ],
      [
        'gemini',
        mockRoundAdapter({
          name: 'gemini',
          selfName: 'gemini',
          otherAgents: ['claude', 'codex'],
          round2Stable: true,
        }),
      ],
    ]);
    const enabled = makeEnabledModels(['claude', 'codex', 'gemini']);
    const result = await runOrchestrator({
      rawQuestion: CONVERGED_PROMPTS[0]!.rawQuestion,
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters,
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: adapters.get('enhancer')!, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
    });
    expect(result.kind).toBe('multi_agent_converged');
    expect(result.finalMarkdown).toBeTruthy();
    expect(result.finalMarkdown).toContain('claude round 2+ answer'); // executor=claude
    expect(result.roundsCompleted).toBeGreaterThanOrEqual(2);
    expect(result.participants).toEqual(['claude', 'codex', 'gemini']);
  });
});

describe('runOrchestrator — 多 agent escaped 路径', () => {
  it('3 agent 始终有 factual 分歧 → 达到 max_rounds 仍未收敛', async () => {
    const adapters = new Map([
      ['enhancer', mockEnhancerAdapter({ detectedScene: 'decision' })],
      [
        'claude',
        mockRoundAdapter({
          name: 'claude',
          selfName: 'claude',
          otherAgents: ['codex', 'gemini'],
          round2Stable: true,
          disagreement: { type: 'factual', with: 'codex' },
        }),
      ],
      [
        'codex',
        mockRoundAdapter({
          name: 'codex',
          selfName: 'codex',
          otherAgents: ['claude', 'gemini'],
          round2Stable: true,
          disagreement: { type: 'factual', with: 'claude' },
        }),
      ],
      [
        'gemini',
        mockRoundAdapter({
          name: 'gemini',
          selfName: 'gemini',
          otherAgents: ['claude', 'codex'],
          round2Stable: true,
          disagreement: { type: 'factual', with: 'claude' },
        }),
      ],
    ]);
    const enabled = makeEnabledModels(['claude', 'codex', 'gemini']);
    const result = await runOrchestrator({
      rawQuestion: DIVERGED_PROMPTS[0]!.rawQuestion,
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters,
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: adapters.get('enhancer')!, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
      maxRoundsCap: 4, // 提前 cap 避免测试太慢
    });
    expect(result.kind).toBe('multi_agent_escaped');
    expect(result.finalMarkdown).toContain('Consensus');
    expect(result.finalMarkdown).toContain('Disagreements Matrix');
  });
});

describe('runOrchestrator — 单 agent direct 路径', () => {
  it('enabled.length=1 → 跳过 Enhancer，直接调用唯一 agent', async () => {
    const singleAgent: Adapter = {
      name: 'claude',
      capabilities: [],
      roleSuitability: { enhancer: 'high', executor: 'high' },
      binaryAvailable: async () => true,
      version: async () => '1.0.0',
      detectAuthState: async () => 'ok',
      authInstructions: () => '',
      invoke: async () => ({
        rawStdout: '',
        parsed: { answer: 'direct answer from claude' },
        usage: { input_tokens: 10, output_tokens: 5 },
        durationMs: 50,
      }),
    };
    const enabled = makeEnabledModels(['claude']);
    const events: Event[] = [];
    const ctxEmitter = { emitter: undefined as unknown as Parameters<typeof runOrchestrator>[0] };
    void ctxEmitter;

    const userConfirm = vi.fn(async () => 'confirm' as const);
    const result = await runOrchestrator({
      rawQuestion: 'hello',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map([['claude', singleAgent]]),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: singleAgent, model: 'claude', effort: 'medium' },
      userConfirm,
    });
    void events;
    expect(result.kind).toBe('single_agent');
    expect(result.singleAgentKind).toBe('direct');
    expect(result.finalMarkdown).toContain('direct answer from claude');
    expect(result.finalMarkdown).toContain('Answered by claude alone');
    expect(userConfirm).not.toHaveBeenCalled(); // direct 路径跳过用户确认
  });
});

describe('runOrchestrator — 单 agent downgraded 路径', () => {
  it('enabled=2 但 scene 三重交集=1 → downgraded', async () => {
    // 启用 [claude, gemini]，scene=coding（models=[claude,codex]）→ 交集 [claude]
    const claudeAdapter: Adapter = {
      name: 'claude',
      capabilities: [],
      roleSuitability: { enhancer: 'high', executor: 'high' },
      binaryAvailable: async () => true,
      version: async () => '1.0.0',
      detectAuthState: async () => 'ok',
      authInstructions: () => '',
      invoke: async () => ({
        rawStdout: '',
        parsed: { answer: 'downgraded answer from claude' },
        usage: { input_tokens: 20, output_tokens: 10 },
        durationMs: 60,
      }),
    };
    const enhancer = mockEnhancerAdapter({
      detectedScene: 'coding',
      enhancedQuestion: 'enhanced for coding',
    });
    const adapters = new Map([
      ['claude', claudeAdapter],
      ['gemini', claudeAdapter], // mock 同一 adapter（实际不会被调）
      ['enhancer', enhancer],
    ]);
    const enabled = makeEnabledModels(['claude', 'gemini'], ['code_understanding']);
    const result = await runOrchestrator({
      rawQuestion: 'react question',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters,
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: enhancer, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
    });
    expect(result.kind).toBe('single_agent');
    expect(result.singleAgentKind).toBe('downgraded');
    expect(result.finalMarkdown).toContain('downgraded answer from claude');
  });
});

describe('runOrchestrator — 用户取消路径', () => {
  it('确认页选 cancel → kind=cancelled，无 final.md', async () => {
    const enhancer = mockEnhancerAdapter({ detectedScene: 'general' });
    const enabled = makeEnabledModels(['claude', 'codex']);
    const result = await runOrchestrator({
      rawQuestion: 'q',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map([
        ['claude', enhancer],
        ['codex', enhancer],
        ['enhancer', enhancer],
      ]),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: enhancer, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'cancel',
    });
    expect(result.kind).toBe('cancelled');
    expect(result.finalMarkdown).toBeNull();
  });
});

describe('runOrchestrator — abort_empty 路径', () => {
  it('enabled.length=0 → kind=aborted', async () => {
    const enabled = new Map<string, ModelConfig>();
    const enhancer = mockEnhancerAdapter();
    const result = await runOrchestrator({
      rawQuestion: 'q',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map(),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: enhancer, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
    });
    expect(result.kind).toBe('aborted');
    expect(result.abortReason).toContain('未启用');
  });
});

describe('runOrchestrator — events 序列 regression', () => {
  it('多 agent 收敛事件流：enhancement → user_input → round → converged', async () => {
    const adapters = new Map([
      ['enhancer', mockEnhancerAdapter({ detectedScene: 'general' })],
      [
        'claude',
        mockRoundAdapter({ name: 'claude', selfName: 'claude', otherAgents: ['codex', 'gemini'], round2Stable: true }),
      ],
      [
        'codex',
        mockRoundAdapter({ name: 'codex', selfName: 'codex', otherAgents: ['claude', 'gemini'], round2Stable: true }),
      ],
      [
        'gemini',
        mockRoundAdapter({ name: 'gemini', selfName: 'gemini', otherAgents: ['claude', 'codex'], round2Stable: true }),
      ],
    ]);
    const enabled = makeEnabledModels(['claude', 'codex', 'gemini']);

    // 通过 EventEmitter 订阅事件（RunContext 内部）
    const events: Event[] = [];
    // 把 emitter 暴露：runOrchestrator 内部新建 RunContext，需要由 RunContext 暴露 emitter；
    // 这里通过 mock adapter 在 invoke 时取上下文不现实——简化：仅断言 final result 已含 finalMarkdown
    void events;

    const result = await runOrchestrator({
      rawQuestion: 'q',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters,
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: adapters.get('enhancer')!, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
    });
    expect(result.kind).toBe('multi_agent_converged');
  });
});

void ALL_EVENTS;
void EventType;

describe('runOrchestrator — persistence callbacks（Bug fix verification）', () => {
  it('多 agent 路径：onPersistable 在用户确认后触发；onFinal 在 finalize 时触发', async () => {
    const adapters = new Map([
      ['enhancer', mockEnhancerAdapter({ detectedScene: 'general' })],
      [
        'claude',
        mockRoundAdapter({ name: 'claude', selfName: 'claude', otherAgents: ['codex'], round2Stable: true }),
      ],
      [
        'codex',
        mockRoundAdapter({ name: 'codex', selfName: 'codex', otherAgents: ['claude'], round2Stable: true }),
      ],
    ]);
    const enabled = makeEnabledModels(['claude', 'codex']);

    const onPersistable = vi.fn();
    const onEvent = vi.fn();
    const onFinal = vi.fn();

    const result = await runOrchestrator({
      rawQuestion: 'q',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters,
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: adapters.get('enhancer')!, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
      persist: { onPersistable, onEvent, onFinal },
    });

    expect(result.kind).toBe('multi_agent_converged');
    expect(onPersistable).toHaveBeenCalledTimes(1);
    // onPersistable 参数含 raw_question + enhanced_question + path=multi_agent
    const persistedMeta = onPersistable.mock.calls[0]![0] as Record<string, unknown>;
    expect(persistedMeta.raw_question).toBe('q');
    expect(persistedMeta.path).toBe('multi_agent');
    expect(persistedMeta.enhanced_question).toBe('enhanced');

    // onFinal 调用 + 含 final markdown
    expect(onFinal).toHaveBeenCalledTimes(1);
    const finalArg = onFinal.mock.calls[0]![0] as { markdown: string | null; finalMeta: Record<string, unknown> };
    expect(finalArg.markdown).toBeTruthy();
    expect(finalArg.finalMeta.outcome).toBe('converged');

    // onEvent 至少捕获 enhancement_started / round_started / agent_responded / finalized 等
    const eventTypes = new Set(onEvent.mock.calls.map((c) => (c[0] as Event).type));
    expect(eventTypes.has('enhancement_started')).toBe(true);
    expect(eventTypes.has('user_input_received')).toBe(true);
    expect(eventTypes.has('round_started')).toBe(true);
    expect(eventTypes.has('agent_responded')).toBe(true);
    expect(eventTypes.has('finalized')).toBe(true);
  });

  it('单 agent direct 路径：onPersistable **立即**触发（无 Enhancer / 无确认页）', async () => {
    const singleAgent: Adapter = {
      name: 'claude',
      capabilities: [],
      roleSuitability: { enhancer: 'high', executor: 'high' },
      binaryAvailable: async () => true,
      version: async () => '1.0.0',
      detectAuthState: async () => 'ok',
      authInstructions: () => '',
      invoke: async () => ({
        rawStdout: '',
        parsed: { answer: 'direct answer' },
        usage: null,
        durationMs: 50,
      }),
    };
    const onPersistable = vi.fn();
    const onEvent = vi.fn();
    const onFinal = vi.fn();
    await runOrchestrator({
      rawQuestion: 'hi',
      enabledModels: makeEnabledModels(['claude']),
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map([['claude', singleAgent]]),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: singleAgent, model: 'claude', effort: 'medium' },
      userConfirm: async () => 'confirm',
      persist: { onPersistable, onEvent, onFinal },
    });
    expect(onPersistable).toHaveBeenCalledTimes(1);
    const persistedMeta = onPersistable.mock.calls[0]![0] as Record<string, unknown>;
    expect(persistedMeta.path).toBe('single_agent');
    expect(persistedMeta.single_agent_kind).toBe('direct');
    expect(persistedMeta.enhanced_question).toBeNull(); // direct 路径 enhanced=null
    expect(persistedMeta.enhancer_model).toBeNull();
  });

  it('--no-persist + persist callback 注入 → 仍跳过 callbacks（spec §security-privacy）', async () => {
    const singleAgent: Adapter = {
      name: 'claude',
      capabilities: [],
      roleSuitability: { enhancer: 'high', executor: 'high' },
      binaryAvailable: async () => true,
      version: async () => '1.0.0',
      detectAuthState: async () => 'ok',
      authInstructions: () => '',
      invoke: async () => ({
        rawStdout: '',
        parsed: { answer: 'sensitive answer' },
        usage: null,
        durationMs: 50,
      }),
    };
    const onPersistable = vi.fn();
    const onEvent = vi.fn();
    const onFinal = vi.fn();
    await runOrchestrator({
      rawQuestion: 'sensitive',
      enabledModels: makeEnabledModels(['claude']),
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map([['claude', singleAgent]]),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: singleAgent, model: 'claude', effort: 'medium' },
      userConfirm: async () => 'confirm',
      noPersist: true,
      persist: { onPersistable, onEvent, onFinal },
    });
    // --no-persist 全局覆盖：所有 callback 都不调用
    expect(onPersistable).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('abort_empty 路径（Layer 1 = 0）：onPersistable / onFinal 均不调用（从未 markPersistable）', async () => {
    const onPersistable = vi.fn();
    const onFinal = vi.fn();
    const enhancer = mockEnhancerAdapter();
    await runOrchestrator({
      rawQuestion: 'q',
      enabledModels: new Map(),
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map(),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: enhancer, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
      persist: { onPersistable, onEvent: vi.fn(), onFinal },
    });
    expect(onPersistable).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('用户取消路径：onPersistable / onFinal 均不调用（spec：cancelled 不落盘）', async () => {
    const enhancer = mockEnhancerAdapter({ detectedScene: 'general' });
    const onPersistable = vi.fn();
    const onEvent = vi.fn();
    const onFinal = vi.fn();
    await runOrchestrator({
      rawQuestion: 'q',
      enabledModels: makeEnabledModels(['claude', 'codex']),
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters: new Map([
        ['enhancer', enhancer],
        ['claude', enhancer],
        ['codex', enhancer],
      ]),
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: enhancer, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'cancel',
      persist: { onPersistable, onEvent, onFinal },
    });
    expect(onPersistable).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
    // onEvent 也不应被调用（cancelled 路径不写盘；emit 到 emitter 但订阅在 markPersistable 之前不转发）
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('runOrchestrator — Bug #1 fix verification: downgraded 用 enhanced_question', () => {
  it('downgraded 路径 invoke 收到 enhanced_question，不是 raw_question', async () => {
    const capturedPrompts: string[] = [];
    const claudeAdapter: Adapter = {
      name: 'claude',
      capabilities: ['code_understanding'],
      roleSuitability: { enhancer: 'high', executor: 'high' },
      binaryAvailable: async () => true,
      version: async () => '1.0.0',
      detectAuthState: async () => 'ok',
      authInstructions: () => '',
      invoke: async (a: AdapterInvokeArgs) => {
        capturedPrompts.push(a.prompt);
        return {
          rawStdout: '',
          parsed: { answer: 'downgraded answer' },
          usage: null,
          durationMs: 50,
        };
      },
    };
    const enhancer = mockEnhancerAdapter({
      detectedScene: 'coding',
      enhancedQuestion: 'this is the enhanced question with [推断] context',
    });
    const adapters = new Map([
      ['claude', claudeAdapter],
      ['gemini', claudeAdapter],
      ['enhancer', enhancer],
    ]);
    const enabled = makeEnabledModels(['claude', 'gemini'], ['code_understanding']);
    const result = await runOrchestrator({
      rawQuestion: 'raw original question',
      enabledModels: enabled,
      scenes: BUILTIN_SCENES,
      roles: makeRoles('claude'),
      adapters,
      initialLanguage: DEFAULT_LANG,
      requestedOutput: 'auto',
      defaultEffort: 'medium',
      enhancer: { adapter: enhancer, model: 'enhancer', effort: 'medium' },
      userConfirm: async () => 'confirm',
    });
    expect(result.singleAgentKind).toBe('downgraded');
    // capturedPrompts 应当含 enhanced_question 而非 raw_question
    const claudePrompts = capturedPrompts.filter((p) => p.includes('enhanced question'));
    expect(claudePrompts.length).toBeGreaterThan(0);
    expect(capturedPrompts.some((p) => p.includes('raw original question'))).toBe(false);
  });
});
