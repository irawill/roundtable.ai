import { describe, expect, it } from 'vitest';
import { renderSingleAgent } from '../../src/finalizer/single-agent.js';

describe('renderSingleAgent — 共享渲染（direct + downgraded）', () => {
  it('含 H1 + answer 原文 + footer "由 X 单独作答"', () => {
    const md = renderSingleAgent({
      question: '推荐扫地机器人',
      output: { answer: '答案：石头 G20S。' },
      agent: 'claude',
      scene: 'general',
      runId: 'r1',
      resolvedUiLanguage: 'zh-Hans',
      singleAgentKind: 'direct',
    });
    expect(md).toContain('# 推荐扫地机器人');
    expect(md).toContain('答案：石头 G20S。');
    expect(md).toContain('由 claude 单独作答（未经圆桌评审）');
    expect(md).toContain('场景: general');
    expect(md).toContain('r1');
  });

  it('direct / downgraded 渲染结果一致（kind 仅 meta 标签，渲染层无差别）', () => {
    const base = {
      question: 'q',
      output: { answer: 'a' },
      agent: 'codex',
      scene: 'general',
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
    } as const;
    const direct = renderSingleAgent({ ...base, singleAgentKind: 'direct' });
    const downgraded = renderSingleAgent({ ...base, singleAgentKind: 'downgraded' });
    expect(direct).toBe(downgraded);
  });

  it('英文 ui language → 英文 footer', () => {
    const md = renderSingleAgent({
      question: 'q',
      output: { answer: 'a' },
      agent: 'claude',
      scene: 'general',
      runId: 'r',
      resolvedUiLanguage: 'en',
      singleAgentKind: 'direct',
    });
    expect(md).toContain('Answered by claude alone (not peer-reviewed)');
    expect(md).toContain('Scene: general');
  });

  it('日文 ui language → 日文 footer', () => {
    const md = renderSingleAgent({
      question: 'q',
      output: { answer: 'a' },
      agent: 'claude',
      scene: 'general',
      runId: 'r',
      resolvedUiLanguage: 'ja',
      singleAgentKind: 'direct',
    });
    expect(md).toContain('claude のみによる回答');
  });

  it('--no-persist 模式：footer 不含 run_id + 含注脚', () => {
    const md = renderSingleAgent({
      question: 'q',
      output: { answer: 'a' },
      agent: 'claude',
      scene: 'general',
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
      singleAgentKind: 'direct',
      noPersist: true,
    });
    expect(md).not.toContain('Run ID: `r`');
    expect(md).toContain('--no-persist');
  });
});
