import { describe, expect, it } from 'vitest';
import {
  buildPriorChainSection,
  buildRound1Prompt,
  buildRound2PlusPrompt,
  buildSingleAgentPrompt,
} from '../../src/orchestrator/round-prompt.js';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';

const codingScene = BUILTIN_SCENES.scenes.coding!;
const consumerScene = BUILTIN_SCENES.scenes.consumer!;

describe('buildRound1Prompt', () => {
  it('含 enhanced_question + agent_role_prompt + 语言指令', () => {
    const p = buildRound1Prompt({
      enhancedQuestion: '推荐扫地机器人',
      scene: consumerScene,
      resolvedOutputLanguage: 'zh-Hans',
    });
    expect(p).toContain('推荐扫地机器人');
    expect(p).toContain('推荐必须引用具体当前产品名');
    expect(p).toContain('zh-Hans');
    expect(p).toContain('## 输出语言');
  });

  it('Round 1 schema 仅含 answer / key_claims / uncertainty_notes / search_evidence', () => {
    const p = buildRound1Prompt({
      enhancedQuestion: 'q',
      scene: codingScene,
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('"answer"');
    expect(p).toContain('"key_claims"');
    expect(p).toContain('"uncertainty_notes"');
    expect(p).toContain('"search_evidence"');
    // Round 1 不要求 peer_review / self_stability
    expect(p).not.toContain('"self_stability"');
    expect(p).not.toContain('"peer_review"');
  });

  it('output_format 注入到 prompt', () => {
    const p = buildRound1Prompt({
      enhancedQuestion: 'q',
      scene: consumerScene, // output_format = markdown_with_comparison_table
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('对比表');
  });
});

describe('buildRound2PlusPrompt', () => {
  it('含上轮其他 agent 输出 + peer_review 名单', () => {
    const p = buildRound2PlusPrompt({
      enhancedQuestion: 'q',
      scene: codingScene,
      selfAgent: 'claude',
      round: 2,
      previousOutputs: {
        codex: '{"answer":"codex-r1"}',
        gemini: '{"answer":"gemini-r1"}',
      },
      activeAgents: ['claude', 'codex', 'gemini'],
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('=== Agent codex 的答案 ===');
    expect(p).toContain('codex-r1');
    expect(p).toContain('=== Agent gemini 的答案 ===');
    expect(p).toContain('gemini-r1');
    expect(p).toContain('"codex"');
    expect(p).toContain('"gemini"');
  });

  it('含防礼貌注入四条', () => {
    const p = buildRound2PlusPrompt({
      enhancedQuestion: 'q',
      scene: codingScene,
      selfAgent: 'claude',
      round: 2,
      previousOutputs: { codex: '{}' },
      activeAgents: ['claude', 'codex'],
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('不要因为礼貌而同意');
    expect(p).toContain('独立验证');
    expect(p).toContain('具体可检验');
    expect(p).toContain('风格不同');
  });

  it('schema 含 self_stability + peer_review', () => {
    const p = buildRound2PlusPrompt({
      enhancedQuestion: 'q',
      scene: codingScene,
      selfAgent: 'a',
      round: 2,
      previousOutputs: {},
      activeAgents: ['a', 'b'],
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('"self_stability"');
    expect(p).toContain('"peer_review"');
  });

  it('上轮 agent 缺失输出 → 提示 ERRORED 仍要 peer_review', () => {
    const p = buildRound2PlusPrompt({
      enhancedQuestion: 'q',
      scene: codingScene,
      selfAgent: 'a',
      round: 2,
      previousOutputs: { b: '{}' },
      activeAgents: ['a', 'b', 'c'],
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('c');
    expect(p).toMatch(/ERRORED|missing/);
  });

  it('Round 2+ 语言指令含 "重申"', () => {
    const p = buildRound2PlusPrompt({
      enhancedQuestion: 'q',
      scene: codingScene,
      selfAgent: 'a',
      round: 3,
      previousOutputs: {},
      activeAgents: ['a', 'b'],
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('重申');
  });
});

describe('buildSingleAgentPrompt', () => {
  it('schema 仅含 answer', () => {
    const p = buildSingleAgentPrompt({
      question: 'q',
      scene: BUILTIN_SCENES.scenes.general!,
      resolvedOutputLanguage: 'en',
    });
    expect(p).toContain('"answer"');
    expect(p).not.toContain('"peer_review"');
    expect(p).not.toContain('"self_stability"');
    expect(p).toContain('单 agent');
  });
});

describe('buildPriorChainSection', () => {
  it('空 chain 返回空串', () => {
    expect(buildPriorChainSection([], 'zh-Hans')).toBe('');
  });

  it('单段 chain 含 header / round label / current turn header / final', () => {
    const s = buildPriorChainSection(
      [{ runId: 'a', enhancedQuestion: 'Q1', finalMd: 'F1' }],
      'zh-Hans',
    );
    expect(s).toContain('先前讨论的链路');
    expect(s).toContain('第 1');
    expect(s).toContain('Q1');
    expect(s).toContain('F1');
    expect(s).toContain('本轮追问');
  });

  it('多段 chain 按时序最旧在前', () => {
    const s = buildPriorChainSection(
      [
        { runId: 'a', enhancedQuestion: 'Q1', finalMd: 'F1' },
        { runId: 'b', enhancedQuestion: 'Q2', finalMd: 'F2' },
      ],
      'en',
    );
    expect(s.indexOf('Q1')).toBeLessThan(s.indexOf('Q2'));
    expect(s).toContain('Round');
    expect(s).toContain('Prior discussion chain');
  });
});

describe('buildRound1Prompt with priorChain', () => {
  it('priorChain 段插入到 enhanced_question 与 agent_role_prompt 之间', () => {
    const p = buildRound1Prompt({
      enhancedQuestion: 'Q_new',
      scene: consumerScene,
      resolvedOutputLanguage: 'zh-Hans',
      priorChain: [{ runId: 'a', enhancedQuestion: 'Q_old', finalMd: 'F_old' }],
    });
    const idxQNew = p.indexOf('Q_new');
    const idxChain = p.indexOf('先前讨论的链路');
    const idxRole = p.indexOf('推荐必须引用具体当前产品名');
    expect(idxQNew).toBeGreaterThan(-1);
    expect(idxChain).toBeGreaterThan(idxQNew);
    expect(idxRole).toBeGreaterThan(idxChain);
    expect(p).toContain('Q_old');
    expect(p).toContain('F_old');
  });

  it('priorChain 缺省时不注入 prior chain 标题', () => {
    const p = buildRound1Prompt({
      enhancedQuestion: 'Q',
      scene: consumerScene,
      resolvedOutputLanguage: 'zh-Hans',
    });
    expect(p).not.toContain('先前讨论的链路');
  });
});
