import { describe, expect, it } from 'vitest';
import { aliasEntryCount, resolveLang } from '../../../src/shared/lang/alias.js';

describe('aliasEntryCount', () => {
  it('至少 25 条主流条目（spec 要求）', () => {
    expect(aliasEntryCount()).toBeGreaterThanOrEqual(25);
  });
});

describe('resolveLang — 关键字保留', () => {
  it('"auto" 解析为 keyword', () => {
    expect(resolveLang('auto')).toEqual({ kind: 'keyword', value: 'auto' });
  });

  it('"system" 解析为 keyword', () => {
    expect(resolveLang('system')).toEqual({ kind: 'keyword', value: 'system' });
  });

  it('"AUTO" 大小写不敏感仍为 keyword', () => {
    expect(resolveLang('AUTO')).toEqual({ kind: 'keyword', value: 'auto' });
  });

  it('关键字 auto / system 不在 alias 表中（不可覆盖）', () => {
    // 不进 alias 表：即使有人尝试 alias auto → en，resolveLang 仍返回 keyword
    expect(resolveLang('auto').kind).toBe('keyword');
    expect(resolveLang('system').kind).toBe('keyword');
  });
});

describe('resolveLang — Alias normalize', () => {
  it('"简中" → zh-Hans', () => {
    expect(resolveLang('简中')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });

  it('"中文" → zh-Hans', () => {
    expect(resolveLang('中文')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });

  it('"zh" → zh-Hans', () => {
    expect(resolveLang('zh')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });

  it('"cn" → zh-Hans', () => {
    expect(resolveLang('cn')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });

  it('"chinese" / "Chinese" → zh-Hans（大小写不敏感）', () => {
    expect(resolveLang('chinese')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
    expect(resolveLang('Chinese')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });

  it('"tw" / "繁中" → zh-Hant', () => {
    expect(resolveLang('tw')).toEqual({ kind: 'bcp47', value: 'zh-Hant' });
    expect(resolveLang('繁中')).toEqual({ kind: 'bcp47', value: 'zh-Hant' });
  });

  it('"jp" / "日本語" → ja', () => {
    expect(resolveLang('jp')).toEqual({ kind: 'bcp47', value: 'ja' });
    expect(resolveLang('日本語')).toEqual({ kind: 'bcp47', value: 'ja' });
  });

  it('"english" → en', () => {
    expect(resolveLang('english')).toEqual({ kind: 'bcp47', value: 'en' });
  });

  it('"pt-br" → pt-BR', () => {
    expect(resolveLang('pt-br')).toEqual({ kind: 'bcp47', value: 'pt-BR' });
  });
});

describe('resolveLang — 直接 BCP-47', () => {
  it('"en" 直接通过', () => {
    expect(resolveLang('en')).toEqual({ kind: 'bcp47', value: 'en' });
  });

  it('"zh-Hans" canonical 直接通过', () => {
    expect(resolveLang('zh-Hans')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });

  it('"vi" 不在 alias 但是合法 BCP-47', () => {
    expect(resolveLang('vi')).toEqual({ kind: 'bcp47', value: 'vi' });
  });

  it('"Zh-hans" 大小写不标准但 normalize 后合法', () => {
    expect(resolveLang('Zh-hans')).toEqual({ kind: 'bcp47', value: 'zh-Hans' });
  });
});

describe('resolveLang — 非法输入', () => {
  it('空字符串 → invalid', () => {
    expect(resolveLang('').kind).toBe('invalid');
  });

  it('"xxxxxx" → invalid', () => {
    expect(resolveLang('xxxxxx').kind).toBe('invalid');
  });

  it('含数字与非法符号 → invalid', () => {
    expect(resolveLang('zh_CN_2024').kind).toBe('invalid');
  });
});
