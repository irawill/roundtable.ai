import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../../src/adapters/registry.js';
import { ModelsFileSchema } from '../../../src/config/schemas/models.js';

describe('buildRegistry — 内置 adapter', () => {
  it('始终注册 3 个内置 adapter（claude / codex / gemini），即使 models.yaml 为空', () => {
    const r = buildRegistry({ models: { models: {} } });
    expect(r.adapters.has('claude')).toBe(true);
    expect(r.adapters.has('codex')).toBe(true);
    expect(r.adapters.has('gemini')).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe('buildRegistry — YAML adapter（自加）', () => {
  it('合法 YAML adapter 注册成功', () => {
    const models = ModelsFileSchema.parse({
      models: {
        kimi: {
          enabled: true,
          type: 'cli',
          command: ['kimi-cli', 'exec'],
          capabilities: ['web_search'],
          role_suitability: { enhancer: 'medium', executor: 'medium' },
          auth: {
            check_command: 'kimi-cli auth check',
            auth_command_hint: '运行 kimi-cli login',
          },
          output: { mode: 'json_extract', json_regex: '(\\{.*\\})' },
          effort_mapping: {
            low: ['--reasoning', 'low'],
            medium: ['--reasoning', 'medium'],
            high: ['--reasoning', 'high'],
          },
        },
      },
    });
    const r = buildRegistry({ models });
    expect(r.adapters.has('kimi')).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('缺 type / command / output / auth 的 YAML adapter → 写 errors，不阻塞 registry', () => {
    // 用 ModelConfigSchema 的最小合法但 YAML adapter 完整性不足
    const models = ModelsFileSchema.parse({
      models: {
        broken: {
          enabled: true,
          // 缺 type / command / output / auth
        },
      },
    });
    let warned: string[] = [];
    const r = buildRegistry({ models, warn: (m) => warned.push(m) });
    expect(r.adapters.has('broken')).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]!.name).toBe('broken');
    expect(r.errors[0]!.message).toContain('type');
    expect(warned.length).toBeGreaterThan(0);
  });

  it('内置 adapter 同名条目在 models.yaml 中不会被覆盖', () => {
    const models = ModelsFileSchema.parse({
      models: {
        claude: {
          enabled: true,
          version: 'claude-opus-4-7',
          // 用户在 models.yaml 中给 claude 加字段，不应触发 YAML adapter 构造
        },
      },
    });
    const r = buildRegistry({ models });
    expect(r.errors).toEqual([]);
    expect(r.adapters.has('claude')).toBe(true);
  });
});

describe('buildRegistry — lastKnownVersions 注入', () => {
  it('内置 adapter 收到 lastKnownVersion 注入（探测时与之对比）', () => {
    const r = buildRegistry({
      models: { models: {} },
      lastKnownVersions: { claude: '1.2.3' },
    });
    // 通过类型穿透读 spec.lastKnownVersion
    const claude = r.adapters.get('claude');
    const lk = (
      claude as unknown as { spec?: { lastKnownVersion?: string | null } }
    ).spec?.lastKnownVersion;
    expect(lk).toBe('1.2.3');
  });
});
