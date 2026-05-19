import { describe, expect, it } from 'vitest';
import { deriveSystemLanguage } from '../../../src/shared/lang/system-language.js';

describe('deriveSystemLanguage', () => {
  it('zh_CN.UTF-8 → zh-Hans', () => {
    expect(deriveSystemLanguage({ LANG: 'zh_CN.UTF-8' })).toBe('zh-Hans');
  });

  it('zh_TW.UTF-8 → zh-Hant', () => {
    expect(deriveSystemLanguage({ LANG: 'zh_TW.UTF-8' })).toBe('zh-Hant');
  });

  it('zh_HK.UTF-8 → zh-Hant', () => {
    expect(deriveSystemLanguage({ LANG: 'zh_HK.UTF-8' })).toBe('zh-Hant');
  });

  it('zh_SG.UTF-8 → zh-Hans', () => {
    expect(deriveSystemLanguage({ LANG: 'zh_SG.UTF-8' })).toBe('zh-Hans');
  });

  it('ja_JP.UTF-8 → ja', () => {
    expect(deriveSystemLanguage({ LANG: 'ja_JP.UTF-8' })).toBe('ja');
  });

  it('ko_KR.UTF-8 → ko', () => {
    expect(deriveSystemLanguage({ LANG: 'ko_KR.UTF-8' })).toBe('ko');
  });

  it('en_US.UTF-8 → en', () => {
    expect(deriveSystemLanguage({ LANG: 'en_US.UTF-8' })).toBe('en');
  });

  it('en_GB.UTF-8 → en', () => {
    expect(deriveSystemLanguage({ LANG: 'en_GB.UTF-8' })).toBe('en');
  });

  it('pt_BR.UTF-8 → pt-BR', () => {
    expect(deriveSystemLanguage({ LANG: 'pt_BR.UTF-8' })).toBe('pt-BR');
  });

  it('pt_PT.UTF-8 → pt（非 BR）', () => {
    expect(deriveSystemLanguage({ LANG: 'pt_PT.UTF-8' })).toBe('pt');
  });

  it('es_ES.UTF-8 → es', () => {
    expect(deriveSystemLanguage({ LANG: 'es_ES.UTF-8' })).toBe('es');
  });

  it('fr_FR.UTF-8 → fr', () => {
    expect(deriveSystemLanguage({ LANG: 'fr_FR.UTF-8' })).toBe('fr');
  });

  it('de_DE.UTF-8 → de', () => {
    expect(deriveSystemLanguage({ LANG: 'de_DE.UTF-8' })).toBe('de');
  });

  it('ru_RU.UTF-8 → ru', () => {
    expect(deriveSystemLanguage({ LANG: 'ru_RU.UTF-8' })).toBe('ru');
  });

  it('vi_VN.UTF-8 → vi（合法 BCP-47，v1 无翻译包但仍记录）', () => {
    expect(deriveSystemLanguage({ LANG: 'vi_VN.UTF-8' })).toBe('vi');
  });

  it('$LANG 未设 → en', () => {
    expect(deriveSystemLanguage({})).toBe('en');
    expect(deriveSystemLanguage({ LANG: '' })).toBe('en');
  });

  it('$LANG = C / POSIX → en', () => {
    expect(deriveSystemLanguage({ LANG: 'C' })).toBe('en');
    expect(deriveSystemLanguage({ LANG: 'POSIX' })).toBe('en');
  });

  it('LC_ALL 优先于 LC_MESSAGES 与 LANG', () => {
    expect(
      deriveSystemLanguage({ LC_ALL: 'ja_JP.UTF-8', LC_MESSAGES: 'en_US.UTF-8', LANG: 'fr_FR.UTF-8' }),
    ).toBe('ja');
  });

  it('LC_MESSAGES 优先于 LANG（无 LC_ALL）', () => {
    expect(deriveSystemLanguage({ LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'fr_FR.UTF-8' })).toBe('ja');
  });

  it('locale 含 @modifier 与 codeset 被正确处理', () => {
    expect(deriveSystemLanguage({ LANG: 'pt_BR.UTF-8@euro' })).toBe('pt-BR');
  });
});
