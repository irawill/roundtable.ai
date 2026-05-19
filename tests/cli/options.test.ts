import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  attachGlobalOptions,
  parseGlobalOptions,
  resolveVerbosity,
} from '../../src/cli/options.js';

describe('attachGlobalOptions — flags 注册', () => {
  it('--scene / --lang / --no-tui / --no-persist 等 flag 都注册', async () => {
    const cmd = new Command('test').exitOverride();
    attachGlobalOptions(cmd);
    let captured: Record<string, unknown> = {};
    cmd.action((opts) => { captured = opts; });

    await cmd.parseAsync([
      'node', 'test',
      '--scene', 'consumer',
      '--lang', 'zh-Hans',
      '--ui-lang', 'en',
      '--effort', 'high',
      '--enhancer', 'claude',
      '--executor', 'rotate',
      '--no-tui',
      '--no-persist',
      '--no-adapters-mjs',
      '--verbose',
    ]);

    expect(captured.scene).toBe('consumer');
    expect(captured.lang).toBe('zh-Hans');
    expect(captured.uiLang).toBe('en');
    expect(captured.effort).toBe('high');
    expect(captured.enhancer).toBe('claude');
    expect(captured.executor).toBe('rotate');
    expect(captured.tui).toBe(false);
    expect(captured.persist).toBe(false);
    expect(captured.adaptersMjs).toBe(false);
    expect(captured.verbose).toBe(true);
  });
});

describe('parseGlobalOptions — 默认值', () => {
  it('未传 flag → 默认值', () => {
    const opts = parseGlobalOptions({});
    expect(opts.tui).toBe(true);
    expect(opts.persist).toBe(true);
    expect(opts.adaptersMjs).toBe(true);
    expect(opts.verbose).toBe(false);
    expect(opts.quiet).toBe(false);
    expect(opts.scene).toBeUndefined();
  });

  it('--no-x flag → false', () => {
    const opts = parseGlobalOptions({ tui: false, persist: false });
    expect(opts.tui).toBe(false);
    expect(opts.persist).toBe(false);
  });
});

describe('resolveVerbosity', () => {
  it('默认 normal', () => {
    expect(resolveVerbosity(parseGlobalOptions({}))).toBe('normal');
  });
  it('--verbose → verbose', () => {
    expect(resolveVerbosity(parseGlobalOptions({ verbose: true }))).toBe('verbose');
  });
  it('--quiet → quiet（quiet 优先）', () => {
    expect(resolveVerbosity(parseGlobalOptions({ quiet: true, verbose: true }))).toBe('quiet');
  });
});
