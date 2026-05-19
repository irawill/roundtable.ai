import { describe, expect, it } from 'vitest';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import { buildEnhancerPrompt } from '../../src/enhancer/prompt.js';

describe('buildEnhancerPrompt — 共通规则', () => {
  it('含原始问题', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: '推荐扫地机器人',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).toContain('推荐扫地机器人');
  });

  it('含 scene catalog（含 7 个内置 scene 名）', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    for (const name of Object.keys(BUILTIN_SCENES.scenes)) {
      expect(p).toContain(name);
    }
  });

  it('含中立性硬规则（禁止环保 / 极简 / 性价比等倾向词）', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).toContain('环保');
    expect(p).toContain('极简');
    expect(p).toContain('性价比');
    expect(p).toMatch(/MUST NOT|不要/);
  });

  it('含 [推断] 前缀规则', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).toContain('[推断]');
  });

  it('含 questions_for_user ≤ 3 约束', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).toContain('最多 3 项');
  });

  it('含代码标识符 / API 名保持原文规则', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).toContain('React');
    expect(p).toContain('Kubernetes');
    expect(p).toContain('保持原文');
  });
});

describe('buildEnhancerPrompt — auto mode 语言指令', () => {
  it('auto 模式包含 user_language / language_confidence 字段要求', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).toContain('user_language');
    expect(p).toContain('language_confidence');
    expect(p).toContain('auto');
  });
});

describe('buildEnhancerPrompt — explicit mode 语言指令', () => {
  it('explicit 模式含 resolved 语言；不要求返回 user_language', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'explicit',
      resolvedOutputLanguage: 'zh-Hans',
    });
    expect(p).toContain('zh-Hans');
    expect(p).toContain('explicit');
    expect(p).toMatch(/不要.*user_language/);
  });
});

describe('buildEnhancerPrompt — 不引入主观倾向词（regression）', () => {
  it('prompt 中明确列出禁用倾向词清单', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: '推荐扫地机器人',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    // 明示禁用而非示例使用——regression 用例
    expect(p).toMatch(/MUST NOT.*环保|不要.*环保|环保.*极简.*性价比/);
  });
});

describe('buildEnhancerPrompt — priorChain（followup）', () => {
  it('priorChain 非空时 prompt 含 "追问" 标识与历史 final', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: '保养有什么坑',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
      priorChain: [
        { runId: 'a', enhancedQuestion: '推荐扫地机', finalMd: '推荐 A / B' },
      ],
    });
    expect(p).toContain('追问');
    expect(p).toContain('推荐扫地机');
    expect(p).toContain('推荐 A / B');
  });

  it('priorChain 缺省时不含追问段', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
    });
    expect(p).not.toContain('这是用户的追问');
  });

  it('多段 priorChain 按时序展示，最旧在前', () => {
    const p = buildEnhancerPrompt({
      rawQuestion: 'q3',
      scenes: BUILTIN_SCENES,
      mode: 'auto',
      priorChain: [
        { runId: 'a', enhancedQuestion: 'Q1', finalMd: 'F1' },
        { runId: 'b', enhancedQuestion: 'Q2', finalMd: 'F2' },
      ],
    });
    expect(p.indexOf('Q1')).toBeLessThan(p.indexOf('Q2'));
    expect(p.indexOf('F1')).toBeLessThan(p.indexOf('F2'));
  });
});
