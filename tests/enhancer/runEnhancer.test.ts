import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import { appendUserAnswers, runEnhancer } from '../../src/enhancer/index.js';
import type { Adapter, AdapterInvokeArgs, AdapterResult } from '../../src/shared/adapter.js';
import type { LanguageState } from '../../src/lang/types.js';

const preResolvedAuto: LanguageState = {
  system: 'zh-Hans',
  requested_output: 'auto',
  resolved_output: 'zh-Hans',
  resolved_ui: 'zh-Hans',
  source: 'auto_detected',
  confidence: null,
  fallback_used: false,
};

const preResolvedEnExplicit: LanguageState = {
  system: 'en',
  requested_output: 'en',
  resolved_output: 'en',
  resolved_ui: 'en',
  source: 'cli_override',
  confidence: null,
  fallback_used: false,
};

function mockAdapter(returnObj: unknown): Adapter {
  return {
    name: 'mock-enhancer',
    capabilities: ['reasoning_effort'],
    roleSuitability: { enhancer: 'high', executor: 'high' },
    binaryAvailable: vi.fn(async () => true),
    version: vi.fn(async () => '1.0.0'),
    detectAuthState: vi.fn(async () => 'ok'),
    authInstructions: vi.fn(() => 'mock'),
    invoke: vi.fn(
      async (_args: AdapterInvokeArgs): Promise<AdapterResult> => ({
        rawStdout: '',
        parsed: returnObj,
        usage: null,
        durationMs: 100,
      }),
    ),
  };
}

function mockFailingAdapter(error: Error): Adapter {
  return {
    name: 'mock-failing',
    capabilities: [],
    roleSuitability: { enhancer: 'low', executor: 'low' },
    binaryAvailable: vi.fn(async () => true),
    version: vi.fn(async () => '1.0.0'),
    detectAuthState: vi.fn(async () => 'ok'),
    authInstructions: vi.fn(() => 'mock'),
    invoke: vi.fn(async () => {
      throw error;
    }),
  };
}

describe('runEnhancer — auto mode 成功', () => {
  it('返回 EnhancerSuccess + language.source=auto_detected', async () => {
    const adapter = mockAdapter({
      detected_scene: 'consumer',
      scene_confidence: 0.95,
      scene_reasoning: '产品推荐',
      inferred_dimensions: { usage_scenario: '[推断] 家用清洁' },
      enhanced_question_so_far: '推荐扫地机器人（家用场景）',
      questions_for_user: ['预算？'],
      user_language: 'zh-Hans',
      language_confidence: 0.97,
    });

    const r = await runEnhancer({
      rawQuestion: '推荐扫地机器人',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
    });

    expect(r.kind).toBe('success');
    if (r.kind === 'success') {
      expect(r.scene).toBe('consumer');
      expect(r.scene_source).toBe('auto');
      expect(r.scene_fallback_used).toBe(false);
      expect(r.language.source).toBe('auto_detected');
      expect(r.language.resolved_output).toBe('zh-Hans');
      expect(r.needs_language_confirmation).toBe(false);
    }
  });
});

describe('runEnhancer — scene_confidence 阈值', () => {
  it('confidence < 0.8 → fallback general + scene_source=fallback_general', async () => {
    const adapter = mockAdapter({
      detected_scene: 'consumer',
      scene_confidence: 0.6, // < 0.8
      scene_reasoning: '不确定',
      inferred_dimensions: {},
      enhanced_question_so_far: 'q',
      questions_for_user: [],
      user_language: 'zh-Hans',
      language_confidence: 0.9,
    });

    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
    });

    if (r.kind !== 'success') throw new Error('expected success');
    expect(r.scene).toBe('general');
    expect(r.scene_source).toBe('fallback_general');
    expect(r.scene_fallback_used).toBe(true);
  });
});

describe('runEnhancer — CLI --scene override', () => {
  it('sceneOverride 命中 → 替换 scene + source=cli_override（忽略 detected_scene）', async () => {
    const adapter = mockAdapter({
      detected_scene: 'consumer', // Enhancer 检测的
      scene_confidence: 0.95,
      scene_reasoning: 'r',
      inferred_dimensions: {},
      enhanced_question_so_far: 'q',
      questions_for_user: [],
      user_language: 'zh-Hans',
      language_confidence: 0.9,
    });

    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
      sceneOverride: 'coding',
    });

    if (r.kind !== 'success') throw new Error('expected success');
    expect(r.scene).toBe('coding');
    expect(r.scene_source).toBe('cli_override');
  });

  it('sceneOverride 不在 scene 清单 → fallback general', async () => {
    const adapter = mockAdapter({
      detected_scene: 'consumer',
      scene_confidence: 0.95,
      scene_reasoning: 'r',
      inferred_dimensions: {},
      enhanced_question_so_far: 'q',
      questions_for_user: [],
      user_language: 'zh-Hans',
      language_confidence: 0.9,
    });

    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
      sceneOverride: 'nonexistent_scene',
    });

    if (r.kind !== 'success') throw new Error('expected success');
    expect(r.scene).toBe('general');
    expect(r.scene_source).toBe('fallback_general');
  });
});

describe('runEnhancer — language_confidence 阈值', () => {
  it('confidence < 0.6 → needs_language_confirmation=true + low_confidence_system_confirmed source', async () => {
    const adapter = mockAdapter({
      detected_scene: 'consumer',
      scene_confidence: 0.95,
      scene_reasoning: 'r',
      inferred_dimensions: {},
      enhanced_question_so_far: 'q',
      questions_for_user: [],
      user_language: 'zh-Hans',
      language_confidence: 0.5,
    });

    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
    });

    if (r.kind !== 'success') throw new Error('expected success');
    expect(r.needs_language_confirmation).toBe(true);
    expect(r.language.source).toBe('low_confidence_system_confirmed');
    expect(r.language.confidence).toBe(0.5);
    expect(r.language_confirmation_prompt).toBeDefined();
  });
});

describe('runEnhancer — explicit mode', () => {
  it('user_language 字段被忽略，language 保留 cli_override', async () => {
    const adapter = mockAdapter({
      detected_scene: 'consumer',
      scene_confidence: 0.95,
      scene_reasoning: 'r',
      inferred_dimensions: {},
      enhanced_question_so_far: 'q',
      questions_for_user: [],
      // explicit 模式下 user_language 即使返回也应被忽略
      user_language: 'zh-Hans',
    });

    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'en',
      preResolvedLanguage: preResolvedEnExplicit,
      adapter,
      effort: 'medium',
    });

    if (r.kind !== 'success') throw new Error('expected success');
    expect(r.language.resolved_output).toBe('en');
    expect(r.language.source).toBe('cli_override');
    expect(r.needs_language_confirmation).toBe(false);
  });
});

describe('runEnhancer — adapter 失败 fallback', () => {
  it('adapter throw → EnhancerFailure + heuristic_applied=true（auto）', async () => {
    const adapter = mockFailingAdapter(new Error('adapter timeout'));

    const r = await runEnhancer({
      rawQuestion: '推荐扫地机器人',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
    });

    expect(r.kind).toBe('failure');
    if (r.kind === 'failure') {
      expect(r.fallback.heuristic_applied).toBe(true);
      expect(r.fallback.language.source).toBe('fallback_heuristic');
      expect(r.fallback.failure_reason).toBe('timeout');
    }
  });

  it('adapter throw + explicit 模式 → 保留已 resolved source', async () => {
    const adapter = mockFailingAdapter(new Error('boom'));

    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'en',
      preResolvedLanguage: preResolvedEnExplicit,
      adapter,
      effort: 'medium',
    });

    if (r.kind !== 'failure') throw new Error('expected failure');
    expect(r.fallback.heuristic_applied).toBe(false);
    expect(r.fallback.language.source).toBe('cli_override');
  });
});

describe('runEnhancer — Zod schema 失败 fallback', () => {
  it('mock 返回非法 schema → EnhancerFailure', async () => {
    const adapter = mockAdapter({ totally: 'wrong shape' });
    const r = await runEnhancer({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      adapter,
      effort: 'medium',
    });
    expect(r.kind).toBe('failure');
  });
});

describe('appendUserAnswers', () => {
  it('追加 Q/A 结构到 enhanced_question 末尾', () => {
    const s = appendUserAnswers({
      enhancedQuestion: '推荐扫地机器人（家用清洁）',
      questions: ['预算？', '硬地板还是地毯？'],
      answers: ['3000-4000 元', '主要硬地板'],
    });
    expect(s).toContain('推荐扫地机器人');
    expect(s).toContain('Q: 预算？');
    expect(s).toContain('A: 3000-4000 元');
    expect(s).toContain('Q: 硬地板还是地毯？');
    expect(s).toContain('A: 主要硬地板');
  });

  it('Q/A 长度不一致时仅匹配对', () => {
    const s = appendUserAnswers({
      enhancedQuestion: 'q',
      questions: ['q1', 'q2', 'q3'],
      answers: ['a1'],
    });
    expect(s.split('\n').filter((l) => l.startsWith('Q:')).length).toBe(1);
  });

  it('空数组 → 原样返回', () => {
    const s = appendUserAnswers({
      enhancedQuestion: 'q',
      questions: [],
      answers: [],
    });
    expect(s).toBe('q');
  });
});
