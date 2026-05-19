import { describe, expect, it } from 'vitest';
import {
  decideLayer1,
  decideLayer2,
  decideLayer2GeneralFallback,
} from '../../src/orchestrator/branching.js';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import type { ModelConfig } from '../../src/config/schemas/models.js';
import { ModelConfigSchema } from '../../src/config/schemas/models.js';

function makeModelConfig(capabilities: string[] = []): ModelConfig {
  return ModelConfigSchema.parse({ enabled: true, capabilities });
}

describe('decideLayer1', () => {
  it('enabled = 0 → abort_empty', () => {
    expect(decideLayer1([]).kind).toBe('abort_empty');
  });

  it('enabled = 1 → single_agent_direct', () => {
    const r = decideLayer1(['claude']);
    expect(r.kind).toBe('single_agent_direct');
    if (r.kind === 'single_agent_direct') expect(r.theOnlyAgent).toBe('claude');
  });

  it('enabled = 2 → enhance', () => {
    expect(decideLayer1(['claude', 'codex']).kind).toBe('enhance');
  });

  it('enabled = 3 → enhance', () => {
    expect(decideLayer1(['claude', 'codex', 'gemini']).kind).toBe('enhance');
  });
});

describe('decideLayer2', () => {
  it('多 agent 圆桌：participants >= 2', () => {
    const enabled = new Map([
      ['claude', makeModelConfig()],
      ['codex', makeModelConfig()],
      ['gemini', makeModelConfig()],
    ]);
    const r = decideLayer2({ scene: BUILTIN_SCENES.scenes.general!, enabledModels: enabled });
    expect(r.kind).toBe('multi_agent_round');
    if (r.kind === 'multi_agent_round') {
      expect(r.participants).toEqual(['claude', 'codex', 'gemini']);
    }
  });

  it('降级 single_agent_downgraded：participants = 1', () => {
    // coding scene models=[claude,codex]，启用 [claude, gemini] → 交集 [claude]
    const enabled = new Map([
      ['claude', makeModelConfig(['code_understanding'])],
      ['gemini', makeModelConfig(['code_understanding'])],
    ]);
    const r = decideLayer2({ scene: BUILTIN_SCENES.scenes.coding!, enabledModels: enabled });
    expect(r.kind).toBe('single_agent_downgraded');
    if (r.kind === 'single_agent_downgraded') {
      expect(r.participant).toBe('claude');
    }
  });

  it('recompute_general_scene：participants = 0', () => {
    // coding scene models=[claude,codex]，启用 [gemini] → 交集 0
    const enabled = new Map([['gemini', makeModelConfig(['code_understanding'])]]);
    const r = decideLayer2({ scene: BUILTIN_SCENES.scenes.coding!, enabledModels: enabled });
    expect(r.kind).toBe('recompute_general_scene');
  });

  it('capability 不足导致 participants = 0', () => {
    // consumer scene 要求 web_search；启用的 model 都没有
    const enabled = new Map([
      ['claude', makeModelConfig([])],
      ['codex', makeModelConfig([])],
    ]);
    const r = decideLayer2({ scene: BUILTIN_SCENES.scenes.consumer!, enabledModels: enabled });
    expect(r.kind).toBe('recompute_general_scene');
  });
});

describe('decideLayer2GeneralFallback', () => {
  it('general fallback 后 >= 2 → multi_agent_round', () => {
    const enabled = new Map([
      ['claude', makeModelConfig()],
      ['codex', makeModelConfig()],
    ]);
    const r = decideLayer2GeneralFallback({
      generalScene: BUILTIN_SCENES.scenes.general!,
      enabledModels: enabled,
    });
    expect(r.kind).toBe('multi_agent_round');
  });

  it('general fallback 后 = 1 → single_agent_downgraded', () => {
    const enabled = new Map([['gemini', makeModelConfig()]]);
    const r = decideLayer2GeneralFallback({
      generalScene: BUILTIN_SCENES.scenes.general!,
      enabledModels: enabled,
    });
    expect(r.kind).toBe('single_agent_downgraded');
  });

  it('general fallback 后仍 = 0 → abort_no_participants', () => {
    const enabled = new Map([['kimi', makeModelConfig()]]); // 自定义 model
    const r = decideLayer2GeneralFallback({
      generalScene: BUILTIN_SCENES.scenes.general!,
      enabledModels: enabled,
    });
    expect(r.kind).toBe('abort_no_participants');
  });
});
