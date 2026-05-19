import { describe, expect, it } from 'vitest';
import { detectAuthState, matchExpiredPattern } from '../../../src/adapters/runtime/auth.js';

describe('detectAuthState — env fast path', () => {
  it('check_env 已设 → 立即返回 ok（不跑 command）', async () => {
    const state = await detectAuthState({
      checkEnv: 'FAKE_API_KEY',
      checkCommand: 'should-never-run',
      env: { FAKE_API_KEY: 'sk-test' },
    });
    expect(state).toBe('ok');
  });

  it('check_env 未设但 check_command 成功（如 codex login status 已登录）→ ok', async () => {
    const state = await detectAuthState({
      checkEnv: 'FAKE_API_KEY',
      checkCommand: 'true', // 系统 true 命令 exit 0
      env: { /* FAKE_API_KEY 未设 */ },
    });
    expect(state).toBe('ok');
  });

  it('check_env 未设且 check_command exit !=0 → missing', async () => {
    const state = await detectAuthState({
      checkEnv: 'FAKE_API_KEY',
      checkCommand: 'false', // 系统 false 命令 exit 1
      env: {},
    });
    expect(state).toBe('missing');
  });

  it('check_env 空字符串视为未设（fast path 不命中）', async () => {
    const state = await detectAuthState({
      checkEnv: 'FAKE_API_KEY',
      checkCommand: 'true',
      env: { FAKE_API_KEY: '' },
    });
    expect(state).toBe('ok'); // 回退跑 command，true exit 0
  });

  it('两者都未配置 → unknown', async () => {
    const state = await detectAuthState({ env: {} });
    expect(state).toBe('unknown');
  });

  it('check_command binary 不存在 → unknown（让 binaryAvailable 单独判定）', async () => {
    const state = await detectAuthState({
      checkCommand: '/non/existent/binary',
      env: {},
    });
    expect(state).toBe('unknown');
  });
});

describe('matchExpiredPattern', () => {
  it('匹配大小写不敏感', () => {
    expect(matchExpiredPattern('Auth Error 401 Unauthorized', ['401', 'unauthorized'])).toBe(true);
    expect(matchExpiredPattern('AUTH ERROR', ['unauthorized'])).toBe(false);
  });

  it('正则模式', () => {
    expect(matchExpiredPattern('your api key has expired today', ['api.*key.*expired'])).toBe(true);
  });

  it('非法正则跳过不抛错', () => {
    expect(matchExpiredPattern('msg', ['[invalid'])).toBe(false);
  });

  it('无匹配 → false', () => {
    expect(matchExpiredPattern('all is fine', ['401', '403'])).toBe(false);
  });
});
