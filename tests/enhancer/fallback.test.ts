import { describe, expect, it } from 'vitest';
import { applyEnhancerFailureFallback } from '../../src/enhancer/fallback.js';
import type { LanguageState } from '../../src/lang/types.js';

const preResolvedAuto: LanguageState = {
  system: 'zh-Hans',
  requested_output: 'auto',
  resolved_output: 'zh-Hans', // 启动时 provisional 取 system
  resolved_ui: 'zh-Hans',
  source: 'auto_detected',
  confidence: null,
  fallback_used: false,
};

const preResolvedExplicit: LanguageState = {
  system: 'en',
  requested_output: 'en',
  resolved_output: 'en',
  resolved_ui: 'en',
  source: 'cli_override',
  confidence: null,
  fallback_used: false,
};

describe('applyEnhancerFailureFallback — auto 模式', () => {
  it('中文问题 + 启发式 → zh-Hans + fallback_heuristic source', () => {
    const r = applyEnhancerFailureFallback({
      rawQuestion: '推荐扫地机器人',
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      failureReason: 'adapter_errored',
    });
    expect(r.enhanced_question).toBe('推荐扫地机器人');
    expect(r.heuristic_applied).toBe(true);
    expect(r.language.source).toBe('fallback_heuristic');
    expect(r.language.resolved_output).toBe('zh-Hans');
    expect(r.language.fallback_used).toBe(true);
  });

  it('英文问题 + 启发式 → systemLang', () => {
    const r = applyEnhancerFailureFallback({
      rawQuestion: 'Recommend a robot vacuum',
      requestedOutput: 'auto',
      preResolvedLanguage: { ...preResolvedAuto, system: 'en' },
      failureReason: 'json_parse_failed',
    });
    expect(r.language.resolved_output).toBe('en');
    expect(r.language.source).toBe('fallback_heuristic');
  });

  it('failure_reason 透传', () => {
    const r = applyEnhancerFailureFallback({
      rawQuestion: 'q',
      requestedOutput: 'auto',
      preResolvedLanguage: preResolvedAuto,
      failureReason: 'timeout',
    });
    expect(r.failure_reason).toBe('timeout');
  });
});

describe('applyEnhancerFailureFallback — explicit 模式', () => {
  it('保留 cli_override source + 不启发式', () => {
    const r = applyEnhancerFailureFallback({
      rawQuestion: '推荐扫地机器人',
      requestedOutput: 'en',
      preResolvedLanguage: preResolvedExplicit,
      failureReason: 'adapter_errored',
    });
    expect(r.heuristic_applied).toBe(false);
    expect(r.language.source).toBe('cli_override'); // 保留
    expect(r.language.resolved_output).toBe('en');
    expect(r.language.fallback_used).toBe(true);
  });

  it('requested=system → 保留 user_pref source', () => {
    const r = applyEnhancerFailureFallback({
      rawQuestion: '推荐扫地机器人',
      requestedOutput: 'system',
      preResolvedLanguage: { ...preResolvedExplicit, source: 'user_pref' },
      failureReason: 'adapter_errored',
    });
    expect(r.language.source).toBe('user_pref');
  });
});
