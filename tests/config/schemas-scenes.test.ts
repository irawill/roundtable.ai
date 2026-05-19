import { describe, expect, it } from 'vitest';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import { SceneConfigSchema, ScenesFileSchema } from '../../src/config/schemas/scenes.js';

describe('SceneConfigSchema — 必填字段', () => {
  const minimalScene = {
    description: '杂类问题',
    models: ['claude', 'codex'],
    min_rounds: 2,
    max_rounds: 4,
    convergence_strictness: 'medium' as const,
    agent_role_prompt: '关注准确性',
    enhancer_focus: '识别缺失上下文',
    required_capabilities: [],
    output_format: 'markdown' as const,
  };

  it('接受最小合法 scene', () => {
    expect(SceneConfigSchema.safeParse(minimalScene).success).toBe(true);
  });

  it('拒绝缺 description', () => {
    const { description: _description, ...rest } = minimalScene;
    expect(SceneConfigSchema.safeParse(rest).success).toBe(false);
  });

  it('拒绝 description 为空字符串', () => {
    expect(SceneConfigSchema.safeParse({ ...minimalScene, description: '' }).success).toBe(false);
  });

  it('拒绝 models 空数组', () => {
    expect(SceneConfigSchema.safeParse({ ...minimalScene, models: [] }).success).toBe(false);
  });

  it('拒绝 max_rounds < min_rounds', () => {
    expect(
      SceneConfigSchema.safeParse({ ...minimalScene, min_rounds: 5, max_rounds: 2 }).success,
    ).toBe(false);
  });

  it('拒绝 convergence_strictness 非 3 个合法值', () => {
    expect(
      SceneConfigSchema.safeParse({
        ...minimalScene,
        convergence_strictness: 'whatever',
      }).success,
    ).toBe(false);
  });

  it('拒绝 output_format 非 6 个合法值', () => {
    expect(
      SceneConfigSchema.safeParse({ ...minimalScene, output_format: 'pdf' }).success,
    ).toBe(false);
  });
});

describe('SceneConfigSchema — scene.executor 嵌套校验', () => {
  const base = {
    description: '杂类',
    models: ['claude'],
    min_rounds: 2,
    max_rounds: 3,
    convergence_strictness: 'medium' as const,
    agent_role_prompt: 'p',
    enhancer_focus: 'f',
    required_capabilities: [],
    output_format: 'markdown' as const,
  };

  it('scene 内 executor.mode = per_scene 被 superRefine 拒绝', () => {
    const r = SceneConfigSchema.safeParse({
      ...base,
      executor: { mode: 'per_scene', model: 'claude' },
    });
    expect(r.success).toBe(false);
  });

  it('scene 内 executor.mode = fixed 必须有 model', () => {
    expect(
      SceneConfigSchema.safeParse({ ...base, executor: { mode: 'fixed' } }).success,
    ).toBe(false);
    expect(
      SceneConfigSchema.safeParse({ ...base, executor: { mode: 'fixed', model: 'claude' } })
        .success,
    ).toBe(true);
  });

  it('scene 内 executor.mode = rotate / random 可缺省 model', () => {
    expect(
      SceneConfigSchema.safeParse({ ...base, executor: { mode: 'rotate' } }).success,
    ).toBe(true);
    expect(
      SceneConfigSchema.safeParse({ ...base, executor: { mode: 'random' } }).success,
    ).toBe(true);
  });
});

describe('内置 7 scenes canonical 文案', () => {
  it('共 7 个 scene', () => {
    expect(Object.keys(BUILTIN_SCENES.scenes)).toHaveLength(7);
  });

  it('全部通过 SceneConfigSchema 校验', () => {
    for (const [name, scene] of Object.entries(BUILTIN_SCENES.scenes)) {
      const r = SceneConfigSchema.safeParse(scene);
      expect(r.success, `${name} 应通过校验`).toBe(true);
    }
  });

  it('顶层 ScenesFileSchema 校验通过', () => {
    expect(ScenesFileSchema.safeParse(BUILTIN_SCENES).success).toBe(true);
  });

  it('consumer scene required_capabilities 含 web_search（来自 §scene-system canonical 文案）', () => {
    expect(BUILTIN_SCENES.scenes.consumer?.required_capabilities).toEqual(['web_search']);
  });

  it('coding scene required_capabilities 含 code_understanding', () => {
    expect(BUILTIN_SCENES.scenes.coding?.required_capabilities).toEqual(['code_understanding']);
  });

  it('coding scene convergence_strictness=strict / effort=high', () => {
    expect(BUILTIN_SCENES.scenes.coding?.convergence_strictness).toBe('strict');
    expect(BUILTIN_SCENES.scenes.coding?.effort).toBe('high');
  });

  it('creative scene effort=low（来自 §scene-system 表格）', () => {
    expect(BUILTIN_SCENES.scenes.creative?.effort).toBe('low');
  });

  it('decision scene min/max = 4/6 + loose strictness', () => {
    expect(BUILTIN_SCENES.scenes.decision?.min_rounds).toBe(4);
    expect(BUILTIN_SCENES.scenes.decision?.max_rounds).toBe(6);
    expect(BUILTIN_SCENES.scenes.decision?.convergence_strictness).toBe('loose');
  });
});
