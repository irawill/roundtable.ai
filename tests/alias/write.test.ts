import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MARKER_LEGACY_SHORT,
  MARKER_PRIMARY_FALLBACK,
  MARKER_SHORT,
} from '../../src/alias/detect.js';
import {
  renderAliasLine,
  unsetAliasFromRc,
  writeAliasToRc,
} from '../../src/alias/write.js';

let tmpRoot: string;
let rcFile: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rtai-alias-write-test-'));
  rcFile = join(tmpRoot, '.zshrc');
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('renderAliasLine — shell 语法', () => {
  it('zsh / bash 用 = 号 + 单引号', () => {
    expect(renderAliasLine('zsh', 'rt', '/abs/rtai')).toBe("alias rt='/abs/rtai'");
    expect(renderAliasLine('bash', 'rt', '/abs/rtai')).toBe("alias rt='/abs/rtai'");
  });

  it('fish 无 = 号', () => {
    expect(renderAliasLine('fish', 'rt', '/abs/rtai')).toBe("alias rt '/abs/rtai'");
  });

  it('nushell 双引号', () => {
    expect(renderAliasLine('nushell', 'rt', '/abs/rtai')).toBe('alias rt = "/abs/rtai"');
  });
});

describe('writeAliasToRc — short marker', () => {
  it('写入 marker + alias 行', () => {
    writeAliasToRc({
      rcFile,
      shell: 'zsh',
      name: 'rt',
      target: '/abs/rtai',
      kind: 'short',
    });
    const content = readFileSync(rcFile, 'utf8');
    expect(content).toContain(MARKER_SHORT);
    expect(content).toContain("alias rt='/abs/rtai'");
  });

  it('rc 文件不存在时自动创建', () => {
    writeAliasToRc({
      rcFile,
      shell: 'zsh',
      name: 'rt',
      target: '/abs/rtai',
      kind: 'short',
    });
    const content = readFileSync(rcFile, 'utf8');
    expect(content).toContain('rt');
  });

  it('重复写入：先移除旧条目（避免重复）', () => {
    writeAliasToRc({ rcFile, shell: 'zsh', name: 'rt', target: '/abs/v1', kind: 'short' });
    writeAliasToRc({ rcFile, shell: 'zsh', name: 'rt', target: '/abs/v2', kind: 'short' });
    const content = readFileSync(rcFile, 'utf8');
    expect(content).not.toContain('/abs/v1');
    expect(content).toContain('/abs/v2');
    // 只有一组 marker + alias（marker 含括号 → 转义）
    const escapedMarker = MARKER_SHORT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(content.match(new RegExp(escapedMarker, 'g'))?.length).toBe(1);
  });
});

describe('writeAliasToRc — primary_fallback marker', () => {
  it('主名兜底用 primary_fallback marker', () => {
    writeAliasToRc({
      rcFile,
      shell: 'zsh',
      name: 'rta',
      target: '/abs/rtai',
      kind: 'primary_fallback',
    });
    const content = readFileSync(rcFile, 'utf8');
    expect(content).toContain(MARKER_PRIMARY_FALLBACK);
    expect(content).not.toContain(MARKER_SHORT);
    expect(content).toContain("alias rta='/abs/rtai'");
  });
});

describe('unsetAliasFromRc — 按 marker 精准移除', () => {
  it('短别名 unset：移除 marker + 下一行', () => {
    // 先有其他内容 + alias 块
    writeFileSync(
      rcFile,
      [
        '# existing user content',
        'export PATH=$PATH:/usr/local/bin',
        '',
        MARKER_SHORT,
        "alias rt='/abs/rtai'",
        '',
        '# more user content',
      ].join('\n'),
      'utf8',
    );
    const removed = unsetAliasFromRc({ rcFile, kind: 'short' });
    expect(removed).toBe(true);
    const content = readFileSync(rcFile, 'utf8');
    expect(content).toContain('# existing user content');
    expect(content).toContain('# more user content');
    expect(content).not.toContain(MARKER_SHORT);
    expect(content).not.toContain("alias rt='/abs/rtai'");
  });

  it('短别名 unset：兼容 legacy marker', () => {
    writeFileSync(
      rcFile,
      `${MARKER_LEGACY_SHORT}\nalias rt='/old/path'\n`,
      'utf8',
    );
    const removed = unsetAliasFromRc({ rcFile, kind: 'short' });
    expect(removed).toBe(true);
    expect(readFileSync(rcFile, 'utf8')).not.toContain('rt');
  });

  it('短别名 unset 不影响 primary_fallback marker', () => {
    writeFileSync(
      rcFile,
      `${MARKER_SHORT}\nalias rt='/abs/rtai'\n\n${MARKER_PRIMARY_FALLBACK}\nalias rta='/abs/rtai'\n`,
      'utf8',
    );
    unsetAliasFromRc({ rcFile, kind: 'short' });
    const content = readFileSync(rcFile, 'utf8');
    expect(content).not.toContain(MARKER_SHORT);
    expect(content).toContain(MARKER_PRIMARY_FALLBACK);
    expect(content).toContain('rta');
  });

  it('rc 文件不存在 → 返回 false', () => {
    const r = unsetAliasFromRc({ rcFile: join(tmpRoot, 'nope'), kind: 'short' });
    expect(r).toBe(false);
  });

  it('无 marker 时返回 false', () => {
    writeFileSync(rcFile, 'export PATH=$PATH:/usr/local/bin\n', 'utf8');
    const r = unsetAliasFromRc({ rcFile, kind: 'short' });
    expect(r).toBe(false);
  });
});
