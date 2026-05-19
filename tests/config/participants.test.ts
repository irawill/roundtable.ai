import { describe, expect, it } from 'vitest';
import { computeParticipants } from '../../src/config/participants.js';

function enabled(map: Record<string, string[]>): Map<string, { capabilities: string[] }> {
  return new Map(Object.entries(map).map(([k, v]) => [k, { capabilities: v }]));
}

describe('computeParticipants — 三重交集', () => {
  it('required_capabilities=[] 时不按能力排除', () => {
    const r = computeParticipants({
      scene: { models: ['claude', 'codex', 'gemini'], required_capabilities: [] },
      enabledModels: enabled({
        claude: [],
        codex: [],
        gemini: [],
      }),
    });
    expect(r.participants).toEqual(['claude', 'codex', 'gemini']);
    expect(r.excludedNotEnabled).toEqual([]);
    expect(r.excludedMissingCapability).toEqual([]);
  });

  it('scene.models 中未启用的 model → excludedNotEnabled', () => {
    const r = computeParticipants({
      scene: { models: ['claude', 'codex', 'gemini'], required_capabilities: [] },
      enabledModels: enabled({ claude: [], codex: [] }),
    });
    expect(r.participants).toEqual(['claude', 'codex']);
    expect(r.excludedNotEnabled).toEqual(['gemini']);
  });

  it('缺 capability 的 model → excludedMissingCapability', () => {
    const r = computeParticipants({
      scene: { models: ['claude', 'codex', 'gemini'], required_capabilities: ['web_search'] },
      enabledModels: enabled({
        claude: ['web_search'],
        codex: ['web_search'],
        gemini: ['code_understanding'], // 缺 web_search
      }),
    });
    expect(r.participants).toEqual(['claude', 'codex']);
    expect(r.excludedMissingCapability).toEqual([{ model: 'gemini', missing: ['web_search'] }]);
  });

  it('保留 scene.models 顺序而非 enabled_models 顺序', () => {
    const r = computeParticipants({
      scene: { models: ['gemini', 'claude', 'codex'], required_capabilities: [] },
      enabledModels: enabled({ codex: [], claude: [], gemini: [] }),
    });
    expect(r.participants).toEqual(['gemini', 'claude', 'codex']);
  });

  it('交集为空（启用列表与 scene.models 无交集）', () => {
    const r = computeParticipants({
      scene: { models: ['claude', 'codex'], required_capabilities: [] },
      enabledModels: enabled({ kimi: [], gemini: [] }),
    });
    expect(r.participants).toEqual([]);
    expect(r.excludedNotEnabled).toEqual(['claude', 'codex']);
  });

  it('多个 required_capabilities 全部缺失', () => {
    const r = computeParticipants({
      scene: {
        models: ['claude'],
        required_capabilities: ['web_search', 'code_execution'],
      },
      enabledModels: enabled({ claude: [] }),
    });
    expect(r.participants).toEqual([]);
    expect(r.excludedMissingCapability).toEqual([
      { model: 'claude', missing: ['web_search', 'code_execution'] },
    ]);
  });

  it('部分缺失的 model 也被排除', () => {
    const r = computeParticipants({
      scene: {
        models: ['claude', 'codex'],
        required_capabilities: ['web_search', 'code_execution'],
      },
      enabledModels: enabled({
        claude: ['web_search', 'code_execution'],
        codex: ['web_search'], // 缺 code_execution
      }),
    });
    expect(r.participants).toEqual(['claude']);
    expect(r.excludedMissingCapability).toEqual([
      { model: 'codex', missing: ['code_execution'] },
    ]);
  });
});
