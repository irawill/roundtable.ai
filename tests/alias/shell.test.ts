import { describe, expect, it } from 'vitest';
import { detectShell } from '../../src/alias/shell.js';

describe('detectShell — Linux', () => {
  it('zsh → ~/.zshrc', () => {
    const r = detectShell({ shellEnv: '/bin/zsh', home: '/home/u', platform: 'linux' });
    expect(r.kind).toBe('zsh');
    expect(r.rcFile).toBe('/home/u/.zshrc');
    expect(r.autoWritable).toBe(true);
  });

  it('bash Linux → ~/.bashrc', () => {
    const r = detectShell({ shellEnv: '/bin/bash', home: '/home/u', platform: 'linux' });
    expect(r.kind).toBe('bash');
    expect(r.rcFile).toBe('/home/u/.bashrc');
  });

  it('fish → ~/.config/fish/config.fish', () => {
    const r = detectShell({
      shellEnv: '/usr/local/bin/fish',
      home: '/home/u',
      platform: 'linux',
    });
    expect(r.kind).toBe('fish');
    expect(r.rcFile).toBe('/home/u/.config/fish/config.fish');
  });

  it('nushell → ~/.config/nushell/config.nu', () => {
    const r = detectShell({ shellEnv: '/opt/nu', home: '/home/u', platform: 'linux' });
    expect(r.kind).toBe('nushell');
    expect(r.rcFile).toBe('/home/u/.config/nushell/config.nu');
  });

  it('unknown shell → kind=unknown, autoWritable=false', () => {
    const r = detectShell({
      shellEnv: '/usr/local/bin/myshell',
      home: '/home/u',
      platform: 'linux',
    });
    expect(r.kind).toBe('unknown');
    expect(r.rcFile).toBeNull();
    expect(r.autoWritable).toBe(false);
  });

  it('$SHELL 未设 → unknown', () => {
    const r = detectShell({ shellEnv: '', home: '/home/u', platform: 'linux' });
    expect(r.kind).toBe('unknown');
  });
});

describe('detectShell — macOS', () => {
  it('bash macOS 优先 ~/.bash_profile（存在时）', () => {
    const r = detectShell({
      shellEnv: '/bin/bash',
      home: '/Users/u',
      platform: 'darwin',
      fileExists: (p) => p === '/Users/u/.bash_profile',
    });
    expect(r.rcFile).toBe('/Users/u/.bash_profile');
  });

  it('bash macOS .bash_profile 不存在 → fallback ~/.bashrc', () => {
    const r = detectShell({
      shellEnv: '/bin/bash',
      home: '/Users/u',
      platform: 'darwin',
      fileExists: () => false,
    });
    expect(r.rcFile).toBe('/Users/u/.bashrc');
  });

  it('zsh macOS 仍 ~/.zshrc', () => {
    const r = detectShell({
      shellEnv: '/bin/zsh',
      home: '/Users/u',
      platform: 'darwin',
    });
    expect(r.rcFile).toBe('/Users/u/.zshrc');
  });
});

describe('detectShell — Windows', () => {
  it('platform=win32 → kind=windows, autoWritable=false', () => {
    const r = detectShell({
      shellEnv: 'powershell',
      home: 'C:\\Users\\u',
      platform: 'win32',
    });
    expect(r.kind).toBe('windows');
    expect(r.rcFile).toBeNull();
    expect(r.autoWritable).toBe(false);
  });
});
