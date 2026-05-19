import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import {
  ConfigLoadError,
  type LoaderIo,
  loadModels,
  loadPrefs,
  loadRoles,
  loadScenes,
} from '../../src/config/loader.js';
import { resolveConfigPaths } from '../../src/config/paths.js';

function makeIo(overrides: Partial<LoaderIo> = {}): {
  io: LoaderIo;
  writes: Map<string, string>;
  warns: string[];
} {
  const files = new Map<string, string>();
  const writes = new Map<string, string>();
  const warns: string[] = [];
  const io: LoaderIo = {
    read: (p) => {
      const f = files.get(p);
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return f;
    },
    write: (p, c) => {
      files.set(p, c);
      writes.set(p, c);
    },
    exists: (p) => files.has(p),
    warn: (m) => warns.push(m),
    ...overrides,
  };
  return { io, writes, warns };
}

const PATHS = resolveConfigPaths({ home: '/home/test', platform: 'linux' });

describe('loadModels', () => {
  it('文件缺失 → throw ConfigLoadError 含 rtai setup 提示', () => {
    const { io } = makeIo();
    expect(() => loadModels(PATHS, io)).toThrow(ConfigLoadError);
    try {
      loadModels(PATHS, io);
    } catch (e) {
      expect(String(e)).toContain('rtai setup');
    }
  });

  it('合法 YAML 通过校验', () => {
    const { io } = makeIo();
    io.write(PATHS.modelsYaml, 'models:\n  claude:\n    enabled: true\n');
    const data = loadModels(PATHS, io);
    expect(data.models.claude?.enabled).toBe(true);
  });

  it('非法 YAML 抛出 ConfigLoadError 含字段路径', () => {
    const { io } = makeIo();
    io.write(PATHS.modelsYaml, 'models:\n  claude:\n    enabled: notabool\n');
    expect(() => loadModels(PATHS, io)).toThrow(ConfigLoadError);
  });
});

describe('loadScenes', () => {
  it('文件缺失 → 自动写入 7 内置 + warn', () => {
    const { io, writes, warns } = makeIo();
    const data = loadScenes(PATHS, io);

    expect(warns[0]).toContain('scenes.yaml 不存在');
    expect(writes.has(PATHS.scenesYaml)).toBe(true);
    expect(Object.keys(data.scenes)).toHaveLength(7);
    expect(data.scenes.consumer?.required_capabilities).toEqual(['web_search']);
  });

  it('写入的 scenes.yaml 内容能被自己重新加载', () => {
    const { io } = makeIo();
    loadScenes(PATHS, io); // 第一次自动写入
    const second = loadScenes(PATHS, io); // 第二次从已写入文件加载
    expect(Object.keys(second.scenes)).toEqual(Object.keys(BUILTIN_SCENES.scenes));
  });

  it('非法 scenes.yaml 抛出 ConfigLoadError', () => {
    const { io } = makeIo();
    io.write(PATHS.scenesYaml, 'scenes:\n  general:\n    description: ""\n'); // 空 description
    expect(() => loadScenes(PATHS, io)).toThrow(ConfigLoadError);
  });
});

describe('loadRoles', () => {
  it('文件缺失 → 返回 undefined + warn（提示用启用列表第一个）', () => {
    const { io, warns } = makeIo();
    const r = loadRoles(PATHS, io);
    expect(r).toBeUndefined();
    expect(warns[0]).toContain('roles.yaml 不存在');
    expect(warns[0]).toContain('rtai config roles');
  });

  it('合法 roles.yaml 通过', () => {
    const { io } = makeIo();
    io.write(
      PATHS.rolesYaml,
      'enhancer:\n  mode: fixed\n  model: claude\nexecutor:\n  mode: rotate\n',
    );
    const r = loadRoles(PATHS, io);
    expect(r?.enhancer.mode).toBe('fixed');
    expect(r?.executor.mode).toBe('rotate');
  });
});

describe('loadPrefs', () => {
  it('文件缺失 → 写入默认值 + warn', () => {
    const { io, writes, warns } = makeIo();
    const prefs = loadPrefs(PATHS, io);
    expect(writes.has(PATHS.prefsYaml)).toBe(true);
    expect(warns[0]).toContain('prefs.yaml 不存在');
    expect(prefs.ui.tui).toBe('on');
  });

  it('写入的 prefs.yaml 能被重新加载', () => {
    const { io } = makeIo();
    loadPrefs(PATHS, io);
    const second = loadPrefs(PATHS, io);
    expect(second.defaults.max_rounds).toBe(4);
  });
});

describe('loader IO 注入（测试隔离 — 不写真实磁盘）', () => {
  it('真实 IO write 调用底层 fs 时被本测试 mock 替换', () => {
    const writeSpy = vi.fn();
    const { io } = makeIo({ write: writeSpy });
    io.write('/tmp/test.yaml', 'hello');
    expect(writeSpy).toHaveBeenCalledWith('/tmp/test.yaml', 'hello');
  });
});
