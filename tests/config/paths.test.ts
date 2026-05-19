import { describe, expect, it } from 'vitest';
import { resolveConfigPaths } from '../../src/config/paths.js';

describe('resolveConfigPaths', () => {
  it('macOS 默认走 ~/.config 与 ~/.local/share', () => {
    const p = resolveConfigPaths({ home: '/Users/alice', platform: 'darwin' });
    expect(p.configDir).toBe('/Users/alice/.config/roundtable.ai');
    expect(p.dataDir).toBe('/Users/alice/.local/share/roundtable.ai');
    expect(p.runsDir).toBe('/Users/alice/.local/share/roundtable.ai/runs');
    expect(p.modelsYaml).toBe('/Users/alice/.config/roundtable.ai/models.yaml');
    expect(p.adaptersMjs).toBe('/Users/alice/.config/roundtable.ai/adapters.mjs');
  });

  it('XDG_CONFIG_HOME 覆盖默认 ~/.config', () => {
    const p = resolveConfigPaths({
      home: '/Users/alice',
      xdgConfigHome: '/custom/xdg/config',
      platform: 'linux',
    });
    expect(p.configDir).toBe('/custom/xdg/config/roundtable.ai');
    // data dir 仍按 home 默认
    expect(p.dataDir).toBe('/Users/alice/.local/share/roundtable.ai');
  });

  it('XDG_DATA_HOME 覆盖默认 ~/.local/share', () => {
    const p = resolveConfigPaths({
      home: '/Users/alice',
      xdgDataHome: '/custom/xdg/data',
      platform: 'linux',
    });
    expect(p.dataDir).toBe('/custom/xdg/data/roundtable.ai');
    expect(p.runsDir).toBe('/custom/xdg/data/roundtable.ai/runs');
  });

  it('Windows 使用 APPDATA', () => {
    const p = resolveConfigPaths({
      home: 'C:\\Users\\alice',
      appData: 'C:\\Users\\alice\\AppData\\Roaming',
      platform: 'win32',
    });
    // 我们在 Node Linux 测试环境运行；只关心拼接是否正确包含 APPDATA
    expect(p.configDir).toContain('AppData');
    expect(p.configDir).toContain('roundtable.ai');
  });
});
