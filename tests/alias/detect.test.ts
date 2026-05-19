import { describe, expect, it } from 'vitest';
import {
  MARKER_LEGACY_SHORT,
  MARKER_PRIMARY_FALLBACK,
  MARKER_SHORT,
  detectOccupancy,
} from '../../src/alias/detect.js';

function ioStub(opts: { pathFiles?: string[]; rcContent?: string }) {
  const stat = (p: string) => (opts.pathFiles ?? []).includes(p);
  const readRc = (_p: string) => opts.rcContent;
  return { stat, readRc };
}

describe('detectOccupancy — PATH 扫描', () => {
  it('PATH 中有 binary → occupied_by_path', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/local/bin:/usr/bin',
      rcFile: null,
      ...ioStub({ pathFiles: ['/usr/local/bin/rt'] }),
    });
    expect(r.kind).toBe('occupied_by_path');
    if (r.kind === 'occupied_by_path') expect(r.path).toBe('/usr/local/bin/rt');
  });

  it('PATH 无 binary + rc 无定义 → free', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({ pathFiles: [], rcContent: '' }),
    });
    expect(r.kind).toBe('free');
  });

  it('rcFile=null（unknown shell）只做 PATH 检测', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: null,
      ...ioStub({ pathFiles: [] }),
    });
    expect(r.kind).toBe('free');
  });
});

describe('detectOccupancy — rc 文件 grep（关键：shell alias 误判用例）', () => {
  it('rc 含 alias rt=（非 marker） → occupied_by_rc（即使 which 看不到也判定占用）', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [], // PATH 中无 rt
        rcContent: "alias rt='/some/other/tool'\n",
      }),
    });
    expect(r.kind).toBe('occupied_by_rc');
    if (r.kind === 'occupied_by_rc') {
      expect(r.line).toContain('alias rt=');
    }
  });

  it('rc 含 function rt → occupied_by_rc', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [],
        rcContent: 'function rt() {\n  echo hi\n}\n',
      }),
    });
    expect(r.kind).toBe('occupied_by_rc');
  });

  it('rc 含带前导空白的 alias 仍命中', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [],
        rcContent: "    alias rt='/some/tool'\n",
      }),
    });
    expect(r.kind).toBe('occupied_by_rc');
  });

  it('rc 含 fish 风格 alias（无 =）', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.config/fish/config.fish',
      ...ioStub({
        pathFiles: [],
        rcContent: "alias rt '/some/tool'\n",
      }),
    });
    expect(r.kind).toBe('occupied_by_rc');
  });
});

describe('detectOccupancy — marker 优先级', () => {
  it('rc 仅含 short marker + alias → managed_by_us(short)', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [],
        rcContent: `${MARKER_SHORT}\nalias rt='/abs/path/to/rtai'\n`,
      }),
    });
    expect(r.kind).toBe('managed_by_us');
    if (r.kind === 'managed_by_us') expect(r.markerKind).toBe('short');
  });

  it('rc 仅含 primary_fallback marker + alias → managed_by_us(primary_fallback)', () => {
    const r = detectOccupancy({
      name: 'rta',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [],
        rcContent: `${MARKER_PRIMARY_FALLBACK}\nalias rta='/abs/path/to/rtai'\n`,
      }),
    });
    expect(r.kind).toBe('managed_by_us');
    if (r.kind === 'managed_by_us') expect(r.markerKind).toBe('primary_fallback');
  });

  it('兼容旧版 marker # rt alias (managed by roundtable.ai) → managed_by_us(short)', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [],
        rcContent: `${MARKER_LEGACY_SHORT}\nalias rt='/abs/path/to/rtai'\n`,
      }),
    });
    expect(r.kind).toBe('managed_by_us');
    if (r.kind === 'managed_by_us') expect(r.markerKind).toBe('short');
  });

  it('rc 同时含 marker alias 与非 marker alias → 优先返回 occupied_by_rc（非 marker 行）', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: [],
        rcContent: `# other tool\nalias rt='/some/other'\n\n${MARKER_SHORT}\nalias rt='/abs/path/to/rtai'\n`,
      }),
    });
    expect(r.kind).toBe('occupied_by_rc');
  });
});

describe('detectOccupancy — PATH 优先级高于 rc', () => {
  it('PATH 有 binary 即使 rc 是 marker，仍返回 occupied_by_path', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/local/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({
        pathFiles: ['/usr/local/bin/rt'],
        rcContent: `${MARKER_SHORT}\nalias rt='/abs/path/to/rtai'\n`,
      }),
    });
    expect(r.kind).toBe('occupied_by_path');
  });
});

describe('detectOccupancy — rc 文件不存在', () => {
  it('rc 文件不存在（readRc 返回 undefined） → free', () => {
    const r = detectOccupancy({
      name: 'rt',
      pathEnv: '/usr/bin',
      rcFile: '/home/u/.zshrc',
      ...ioStub({ pathFiles: [] }), // rcContent undefined
    });
    expect(r.kind).toBe('free');
  });
});
