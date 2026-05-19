import { describe, expect, it } from 'vitest';
import {
  ADAPTER_DEFAULT_EFFORT,
  EffortParseError,
  parseCliEffort,
  resolveEffort,
} from '../../src/config/effort.js';

describe('resolveEffort — 4 层优先级', () => {
  it('Layer 1：CLI global override 击穿所有下层', () => {
    expect(
      resolveEffort({
        cli: { kind: 'global', level: 'max' },
        scene: { effort: 'low' },
        modelConfig: { effort: 'low' },
        modelName: 'claude',
      }),
    ).toBe('max');
  });

  it('Layer 1：CLI per-model 命中 → 取 CLI 值', () => {
    expect(
      resolveEffort({
        cli: { kind: 'perModel', map: new Map([['claude', 'high']]) },
        scene: { effort: 'low' },
        modelConfig: { effort: 'low' },
        modelName: 'claude',
      }),
    ).toBe('high');
  });

  it('Layer 1：CLI per-model 未命中 → 继续 Layer 2', () => {
    expect(
      resolveEffort({
        cli: { kind: 'perModel', map: new Map([['claude', 'high']]) },
        scene: { effort: 'low' },
        modelConfig: { effort: 'medium' },
        modelName: 'codex', // 不在 map 中
      }),
    ).toBe('low');
  });

  it('Layer 2a：scene.effort_per_model 优先于 scene.effort', () => {
    expect(
      resolveEffort({
        cli: undefined,
        scene: { effort: 'low', effort_per_model: { claude: 'max' } },
        modelConfig: { effort: 'medium' },
        modelName: 'claude',
      }),
    ).toBe('max');
  });

  it('Layer 2b：scene.effort（per-model 未命中本 model）', () => {
    expect(
      resolveEffort({
        cli: undefined,
        scene: { effort: 'high', effort_per_model: { codex: 'max' } },
        modelConfig: { effort: 'medium' },
        modelName: 'claude',
      }),
    ).toBe('high');
  });

  it('Layer 3：model 自带默认（无 scene level）', () => {
    expect(
      resolveEffort({
        cli: undefined,
        scene: {},
        modelConfig: { effort: 'low' },
        modelName: 'claude',
      }),
    ).toBe('low');
  });

  it('Layer 4：Adapter 内置默认 medium', () => {
    expect(
      resolveEffort({
        cli: undefined,
        scene: {},
        modelConfig: {},
        modelName: 'claude',
      }),
    ).toBe(ADAPTER_DEFAULT_EFFORT);
    expect(ADAPTER_DEFAULT_EFFORT).toBe('medium');
  });
});

describe('parseCliEffort', () => {
  const enabled = new Set(['claude', 'codex', 'gemini']);

  it('global 形态 "high"', () => {
    const r = parseCliEffort('high', enabled);
    expect(r).toEqual({ kind: 'global', level: 'high' });
  });

  it('global 形态非法 level → throw', () => {
    expect(() => parseCliEffort('ultra', enabled)).toThrow(EffortParseError);
  });

  it('perModel 形态 "claude:max,codex:high"', () => {
    const r = parseCliEffort('claude:max,codex:high', enabled);
    expect(r?.kind).toBe('perModel');
    if (r?.kind === 'perModel') {
      expect(r.map.get('claude')).toBe('max');
      expect(r.map.get('codex')).toBe('high');
    }
  });

  it('perModel：model 未启用 → throw', () => {
    expect(() => parseCliEffort('unknown:max', enabled)).toThrow(EffortParseError);
  });

  it('perModel：level 非法 → throw', () => {
    expect(() => parseCliEffort('claude:ultra', enabled)).toThrow(EffortParseError);
  });

  it('空字符串 → throw', () => {
    expect(() => parseCliEffort('', enabled)).toThrow(EffortParseError);
  });

  it('perModel 段格式非法（缺 ":"）→ throw', () => {
    expect(() => parseCliEffort('claude,codex:high', enabled)).toThrow(EffortParseError);
  });

  it('perModel 段格式非法（":" 在末尾）→ throw', () => {
    expect(() => parseCliEffort('claude:', enabled)).toThrow(EffortParseError);
  });
});
