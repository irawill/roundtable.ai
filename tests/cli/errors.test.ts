import { describe, expect, it } from 'vitest';
import {
  CliError,
  ExitCode,
  handleTopLevelError,
  logRuntimeError,
} from '../../src/cli/errors.js';

describe('CliError', () => {
  it('携带 message + exit code + hint', () => {
    const err = new CliError('bad config', ExitCode.ConfigError, 'run rtai setup');
    expect(err.message).toBe('bad config');
    expect(err.code).toBe(ExitCode.ConfigError);
    expect(err.hint).toBe('run rtai setup');
  });
});

describe('handleTopLevelError', () => {
  it('CliError → stderr 含 message + hint，exit code', () => {
    const stderrLines: string[] = [];
    let exitCode = 999;
    expect(() =>
      handleTopLevelError(
        new CliError('bad', ExitCode.ConfigError, 'try this'),
        (s) => stderrLines.push(s),
        ((code: number) => {
          exitCode = code;
          throw new Error('__exit__');
        }) as never,
      ),
    ).toThrow('__exit__');
    expect(stderrLines.join('')).toContain('✗ bad');
    expect(stderrLines.join('')).toContain('hint: try this');
    expect(exitCode).toBe(ExitCode.ConfigError);
  });

  it('普通 Error → stderr message + generic exit code', () => {
    const stderrLines: string[] = [];
    let exitCode = 999;
    expect(() =>
      handleTopLevelError(
        new Error('boom'),
        (s) => stderrLines.push(s),
        ((code: number) => {
          exitCode = code;
          throw new Error('__exit__');
        }) as never,
      ),
    ).toThrow('__exit__');
    expect(stderrLines.join('')).toContain('boom');
    expect(exitCode).toBe(ExitCode.GenericError);
  });

  it('非 Error 输入 → stringify', () => {
    const stderrLines: string[] = [];
    expect(() =>
      handleTopLevelError(
        'just a string',
        (s) => stderrLines.push(s),
        (() => {
          throw new Error('__exit__');
        }) as never,
      ),
    ).toThrow('__exit__');
    expect(stderrLines.join('')).toContain('unknown error: just a string');
  });
});

describe('logRuntimeError', () => {
  it('不含 prompt 内容', () => {
    const lines: string[] = [];
    logRuntimeError({
      run_id: 'abc',
      adapter: 'claude',
      category: 'timeout',
      writeStderr: (s) => lines.push(s),
    });
    const out = lines.join('');
    expect(out).toContain('[run_id=abc]');
    expect(out).toContain('adapter=claude');
    expect(out).toContain('error=timeout');
    expect(out).not.toContain('user question');
  });
});
