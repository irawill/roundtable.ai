import { describe, expect, it } from 'vitest';
import { ModelConfigSchema, ModelsFileSchema } from '../../src/config/schemas/models.js';

describe('ModelConfigSchema', () => {
  it('接受最小合法 model 配置', () => {
    const r = ModelConfigSchema.safeParse({ enabled: true });
    expect(r.success).toBe(true);
    if (r.success) {
      // 默认值
      expect(r.data.prompt_transport).toBe('stdin');
      expect(r.data.timeout_s).toBe(300);
      expect(r.data.capabilities).toEqual([]);
    }
  });

  it('接受完整 model 配置（内置 adapter 风格）', () => {
    const r = ModelConfigSchema.safeParse({
      enabled: true,
      version: 'claude-opus-4-7',
      effort: 'high',
      capabilities: ['web_search', 'code_understanding'],
      role_suitability: { enhancer: 'high', executor: 'high' },
      auth: {
        check_command: 'claude doctor',
        auth_command_hint: 'Run `claude login` in another terminal',
        stderr_expired_patterns: ['401', 'unauthorized'],
      },
      prompt_transport: 'stdin',
      output: { mode: 'stream_json' },
      usage: { mode: 'stream_json' },
      effort_mapping: {
        none: [],
        low: ['--effort', 'low'],
        medium: ['--effort', 'medium'],
        high: ['--effort', 'high'],
        max: ['--effort', 'max'],
      },
      timeout_s: 300,
    });
    expect(r.success).toBe(true);
  });

  it('拒绝 effort 非 5 个合法值', () => {
    const r = ModelConfigSchema.safeParse({ enabled: true, effort: 'ultra' });
    expect(r.success).toBe(false);
  });

  it('output.mode = json_extract 时 output.json_regex 必填', () => {
    const ok = ModelConfigSchema.safeParse({
      enabled: true,
      output: { mode: 'json_extract', json_regex: '\\{.*\\}' },
    });
    expect(ok.success).toBe(true);

    const bad = ModelConfigSchema.safeParse({
      enabled: true,
      output: { mode: 'json_extract' },
    });
    expect(bad.success).toBe(false);
  });

  it('prompt_transport 默认 stdin', () => {
    const r = ModelConfigSchema.safeParse({ enabled: true });
    expect(r.success && r.data.prompt_transport).toBe('stdin');
  });

  it('usage.mode = regex 时 usage.regex 必填', () => {
    const bad = ModelConfigSchema.safeParse({ enabled: true, usage: { mode: 'regex' } });
    expect(bad.success).toBe(false);

    const ok = ModelConfigSchema.safeParse({
      enabled: true,
      usage: { mode: 'regex', regex: 'tokens=(\\d+)' },
    });
    expect(ok.success).toBe(true);
  });

  it('timeout_s 必须正整数', () => {
    expect(ModelConfigSchema.safeParse({ enabled: true, timeout_s: 0 }).success).toBe(false);
    expect(ModelConfigSchema.safeParse({ enabled: true, timeout_s: -5 }).success).toBe(false);
    expect(ModelConfigSchema.safeParse({ enabled: true, timeout_s: 1.5 }).success).toBe(false);
  });
});

describe('ModelsFileSchema', () => {
  it('接受 models map', () => {
    const r = ModelsFileSchema.safeParse({
      models: {
        claude: { enabled: true },
        codex: { enabled: false },
      },
    });
    expect(r.success).toBe(true);
  });

  it('拒绝顶层缺 models 字段', () => {
    expect(ModelsFileSchema.safeParse({}).success).toBe(false);
  });
});
