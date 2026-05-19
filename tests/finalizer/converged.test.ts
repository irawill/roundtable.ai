import { describe, expect, it } from 'vitest';
import { renderConverged } from '../../src/finalizer/converged.js';
import type { Round2PlusOutput } from '../../src/shared/agent-output-schema.js';

const sampleExecutor: Round2PlusOutput = {
  answer: '推荐石头 G20S：3000 元档位最优，覆盖 120 平场景。\n\n## 价格\n3000-4000 元。',
  key_claims: ['G20S 推荐'],
  uncertainty_notes: [],
  search_evidence: [],
  self_stability: 'stable',
  self_change_summary: '',
  peer_review: [],
};

describe('renderConverged — 轻包装', () => {
  it('输出含 H1 + answer 原文 + footer', () => {
    const md = renderConverged({
      enhancedQuestion: '推荐扫地机器人',
      executorOutput: sampleExecutor,
      scene: 'consumer',
      roundsCompleted: 3,
      participants: ['claude', 'codex', 'gemini'],
      executor: 'claude',
      runId: 'abc-123',
      resolvedUiLanguage: 'zh-Hans',
    });
    expect(md).toContain('# 推荐扫地机器人');
    expect(md).toContain('推荐石头 G20S');
    expect(md).toContain('场景: consumer');
    expect(md).toContain('轮次: 3');
    expect(md).toContain('claude / codex / gemini');
    expect(md).toContain('执笔人: claude');
    expect(md).toContain('abc-123');
  });

  it('answer 原文不被修改（包含完整长度）', () => {
    const md = renderConverged({
      enhancedQuestion: 'q',
      executorOutput: sampleExecutor,
      scene: 'consumer',
      roundsCompleted: 1,
      participants: ['a'],
      executor: 'a',
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
    });
    // 包含原文中的特殊片段
    expect(md).toContain('## 价格');
    expect(md).toContain('3000-4000 元。');
  });

  it('长 enhanced_question 截取到 60 字符 + 省略号', () => {
    const longQ = '推荐'.repeat(50);
    const md = renderConverged({
      enhancedQuestion: longQ,
      executorOutput: sampleExecutor,
      scene: 'consumer',
      roundsCompleted: 1,
      participants: ['a'],
      executor: 'a',
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
    });
    // 第一行 H1 长度 ≤ 60 字符 + …
    const firstLine = md.split('\n')[0]!;
    expect(firstLine.endsWith('…')).toBe(true);
  });

  it('空 enhanced_question → fallback 翻译包默认标题', () => {
    const md = renderConverged({
      enhancedQuestion: '',
      executorOutput: sampleExecutor,
      scene: 'consumer',
      roundsCompleted: 1,
      participants: ['a'],
      executor: 'a',
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
    });
    expect(md).toContain('# 圆桌答案');
  });

  it('--no-persist 模式：footer 不含 run_id + 含注脚', () => {
    const md = renderConverged({
      enhancedQuestion: 'q',
      executorOutput: sampleExecutor,
      scene: 'consumer',
      roundsCompleted: 1,
      participants: ['a'],
      executor: 'a',
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
      noPersist: true,
    });
    expect(md).not.toContain('Run ID: `r`');
    expect(md).toContain('--no-persist');
  });

  it('英文 ui language → 英文 footer 标签', () => {
    const md = renderConverged({
      enhancedQuestion: 'q',
      executorOutput: sampleExecutor,
      scene: 'consumer',
      roundsCompleted: 1,
      participants: ['a'],
      executor: 'a',
      runId: 'r',
      resolvedUiLanguage: 'en',
    });
    expect(md).toContain('Scene: consumer');
    expect(md).toContain('Rounds: 1');
    expect(md).toContain('Executor: a');
  });
});
