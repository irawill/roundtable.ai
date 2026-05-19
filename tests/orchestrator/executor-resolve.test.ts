import { describe, expect, it } from 'vitest';
import {
  ExecutorResolveError,
  resolveExecutor,
} from '../../src/orchestrator/executor-resolve.js';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import type { RolesFile } from '../../src/config/schemas/roles.js';
import type { SceneConfig } from '../../src/config/schemas/scenes.js';

const codingScene = BUILTIN_SCENES.scenes.coding!;
const generalScene = BUILTIN_SCENES.scenes.general!;

function roles(executor: RolesFile['executor']): RolesFile {
  return {
    enhancer: { mode: 'fixed', model: 'claude' },
    executor,
  };
}

describe('resolveExecutor — fixed mode', () => {
  it('fixed model 在 participants 中 → 直接返回', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'fixed', model: 'claude' }),
      scene: codingScene,
      participants: ['claude', 'codex'],
      runUuid: 'uuid',
      sceneName: 'coding',
    });
    expect(r.executor).toBe('claude');
    expect(r.mode).toBe('fixed');
    expect(r.fallbackUsed).toBe(false);
  });

  it('fixed model 不在 participants → fallback participants[0] + warning', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'fixed', model: 'gemini' }),
      scene: codingScene,
      participants: ['claude', 'codex'],
      runUuid: 'uuid',
      sceneName: 'coding',
    });
    expect(r.executor).toBe('claude');
    expect(r.fallbackUsed).toBe(true);
    expect(r.originalModel).toBe('gemini');
    expect(r.warning).toContain('gemini');
    expect(r.warning).toContain('claude');
  });
});

describe('resolveExecutor — rotate mode', () => {
  it('确定性：同 uuid + sceneName 多次解析结果一致', () => {
    const base = {
      roles: roles({ mode: 'rotate' }),
      scene: codingScene,
      participants: ['claude', 'codex', 'gemini'],
      runUuid: 'fixed-uuid-1234',
      sceneName: 'coding',
    } as const;
    const a = resolveExecutor(base);
    const b = resolveExecutor(base);
    expect(a.executor).toBe(b.executor);
  });

  it('永远 ∈ participants', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'rotate' }),
      scene: codingScene,
      participants: ['claude', 'codex'],
      runUuid: 'some-uuid',
      sceneName: 'coding',
    });
    expect(['claude', 'codex']).toContain(r.executor);
  });

  it('不同 uuid 分布在 participants 中（采样验证）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = resolveExecutor({
        roles: roles({ mode: 'rotate' }),
        scene: codingScene,
        participants: ['claude', 'codex', 'gemini'],
        runUuid: `uuid-${i}`,
        sceneName: 'coding',
      });
      seen.add(r.executor);
    }
    // 30 次足以采到所有 3 个
    expect(seen.size).toBe(3);
  });
});

describe('resolveExecutor — random mode', () => {
  it('永远 ∈ participants', () => {
    for (let i = 0; i < 20; i++) {
      const r = resolveExecutor({
        roles: roles({ mode: 'random' }),
        scene: codingScene,
        participants: ['claude', 'codex'],
        runUuid: 'x',
        sceneName: 'coding',
      });
      expect(['claude', 'codex']).toContain(r.executor);
    }
  });
});

describe('resolveExecutor — per_scene mode', () => {
  it('scene.executor 有 fixed model → 取该 model', () => {
    const sceneWithExecutor: SceneConfig = {
      ...codingScene,
      executor: { mode: 'fixed', model: 'codex' },
    };
    const r = resolveExecutor({
      roles: roles({ mode: 'per_scene' }),
      scene: sceneWithExecutor,
      participants: ['claude', 'codex'],
      runUuid: 'x',
      sceneName: 'coding',
    });
    expect(r.executor).toBe('codex');
  });

  it('scene 未配置 executor → fallback participants[0]', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'per_scene' }),
      scene: codingScene, // 内置 scene 无 executor 字段
      participants: ['claude', 'codex'],
      runUuid: 'x',
      sceneName: 'coding',
    });
    expect(r.executor).toBe('claude');
    expect(r.fallbackUsed).toBe(true);
  });
});

describe('resolveExecutor — CLI --executor override', () => {
  it('CLI 显式 model 在 participants → 用该 model', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'rotate' }),
      scene: codingScene,
      participants: ['claude', 'codex'],
      runUuid: 'x',
      sceneName: 'coding',
      cliExecutorOverride: 'codex',
    });
    expect(r.executor).toBe('codex');
    expect(r.mode).toBe('fixed');
  });

  it('CLI model 不在 participants → throw（不 fallback）', () => {
    expect(() =>
      resolveExecutor({
        roles: roles({ mode: 'fixed', model: 'claude' }),
        scene: codingScene,
        participants: ['claude', 'codex'],
        runUuid: 'x',
        sceneName: 'coding',
        cliExecutorOverride: 'gemini',
      }),
    ).toThrow(ExecutorResolveError);
  });

  it('CLI "rotate" 关键字 → rotate mode', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'fixed', model: 'claude' }),
      scene: codingScene,
      participants: ['claude', 'codex', 'gemini'],
      runUuid: 'uuid',
      sceneName: 'coding',
      cliExecutorOverride: 'rotate',
    });
    expect(r.mode).toBe('rotate');
    expect(['claude', 'codex', 'gemini']).toContain(r.executor);
  });

  it('CLI "random" 关键字 → random mode', () => {
    const r = resolveExecutor({
      roles: roles({ mode: 'fixed', model: 'claude' }),
      scene: codingScene,
      participants: ['claude', 'codex'],
      runUuid: 'uuid',
      sceneName: 'coding',
      cliExecutorOverride: 'random',
    });
    expect(r.mode).toBe('random');
    expect(['claude', 'codex']).toContain(r.executor);
  });
});

describe('resolveExecutor — 边界', () => {
  it('participants 空 → throw', () => {
    expect(() =>
      resolveExecutor({
        roles: roles({ mode: 'rotate' }),
        scene: codingScene,
        participants: [],
        runUuid: 'x',
        sceneName: 'coding',
      }),
    ).toThrow(ExecutorResolveError);
  });
});

// 防御性：参数包含变量"_" 但未使用——避免 lint 报错
const _unused = generalScene;
