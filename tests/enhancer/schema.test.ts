import { describe, expect, it } from 'vitest';
import { EnhancerOutputSchema } from '../../src/enhancer/schema.js';

const validMinimal = {
  detected_scene: 'consumer',
  scene_confidence: 0.9,
  scene_reasoning: '问题涉及产品推荐',
  inferred_dimensions: {
    usage_scenario: '[推断] 家用清洁',
  },
  enhanced_question_so_far: '推荐扫地机器人（家用清洁场景）',
  questions_for_user: ['你的预算大概是多少？', '主要用在硬地板还是地毯？'],
  user_language: 'zh-Hans',
  language_confidence: 0.95,
};

describe('EnhancerOutputSchema — 合法 input', () => {
  it('接受完整 auto 模式输出', () => {
    expect(EnhancerOutputSchema.safeParse(validMinimal).success).toBe(true);
  });

  it('接受 explicit 模式输出（无 user_language / language_confidence）', () => {
    const { user_language: _ul, language_confidence: _lc, ...rest } = validMinimal;
    expect(EnhancerOutputSchema.safeParse(rest).success).toBe(true);
  });

  it('接受空 questions_for_user 数组', () => {
    expect(
      EnhancerOutputSchema.safeParse({ ...validMinimal, questions_for_user: [] }).success,
    ).toBe(true);
  });

  it('inferred_dimensions 接受 [infer] 英文前缀（双语容错）', () => {
    expect(
      EnhancerOutputSchema.safeParse({
        ...validMinimal,
        inferred_dimensions: { x: '[infer] english value' },
      }).success,
    ).toBe(true);
  });
});

describe('EnhancerOutputSchema — 非法 input', () => {
  it('拒绝 questions_for_user 超过 3 个', () => {
    expect(
      EnhancerOutputSchema.safeParse({
        ...validMinimal,
        questions_for_user: ['q1', 'q2', 'q3', 'q4'],
      }).success,
    ).toBe(false);
  });

  it('拒绝 inferred_dimensions 值不带 [推断] 前缀（不主观注入用户偏好倾向）', () => {
    expect(
      EnhancerOutputSchema.safeParse({
        ...validMinimal,
        inferred_dimensions: { eco: '环保优先' }, // 缺 [推断]
      }).success,
    ).toBe(false);
  });

  it('拒绝 scene_confidence 超出 [0, 1]', () => {
    expect(
      EnhancerOutputSchema.safeParse({ ...validMinimal, scene_confidence: 1.5 }).success,
    ).toBe(false);
    expect(
      EnhancerOutputSchema.safeParse({ ...validMinimal, scene_confidence: -0.1 }).success,
    ).toBe(false);
  });

  it('拒绝 enhanced_question_so_far 为空', () => {
    expect(
      EnhancerOutputSchema.safeParse({ ...validMinimal, enhanced_question_so_far: '' }).success,
    ).toBe(false);
  });

  it('拒绝 detected_scene 为空', () => {
    expect(
      EnhancerOutputSchema.safeParse({ ...validMinimal, detected_scene: '' }).success,
    ).toBe(false);
  });
});
