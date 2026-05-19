import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../src/shared/event-emitter.js';
import { EventType, type Event } from '../../src/shared/event-types.js';
import { emitStartupInfo, startStdoutPresenter } from '../../src/presenters/stdout.js';

function makeEvent(
  type: EventType,
  data: Record<string, unknown> = {},
  round?: number,
): Event {
  return {
    type,
    timestamp: '2026-05-15T10:00:00.000Z',
    run_id: 'r1',
    ...(round !== undefined ? { round } : {}),
    data,
  };
}

describe('stdout presenter — TUI on（默认）', () => {
  it('中间进度不写 stdout 也不写 stderr', () => {
    const emitter = new EventEmitter();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: true,
      verbosity: 'normal',
      stdout: (s) => stdoutLines.push(s),
      stderr: (s) => stderrLines.push(s),
    });
    emitter.emit(makeEvent(EventType.RoundStarted, { active_agents: ['a', 'b'] }, 1));
    emitter.emit(makeEvent(EventType.AgentResponded, { agent: 'a' }, 1));
    expect(stdoutLines).toEqual([]);
    expect(stderrLines).toEqual([]);
  });

  it('finalized_converged 把 markdown 写入 stdout', () => {
    const emitter = new EventEmitter();
    const stdoutLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: true,
      verbosity: 'normal',
      stdout: (s) => stdoutLines.push(s),
      stderr: () => {},
    });
    emitter.emit(makeEvent(EventType.FinalizedConverged, { markdown: '# Final Answer\n\nContent.' }));
    expect(stdoutLines.join('')).toContain('# Final Answer');
    expect(stdoutLines.join('')).toContain('Content.');
  });
});

describe('stdout presenter — TUI off', () => {
  it('中间进度写 stderr', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: false,
      verbosity: 'normal',
      stdout: () => {},
      stderr: (s) => stderrLines.push(s),
    });
    emitter.emit(makeEvent(EventType.EnhancementStarted));
    emitter.emit(makeEvent(EventType.RoundStarted, { active_agents: ['a', 'b'] }, 1));
    emitter.emit(makeEvent(EventType.AgentResponded, { agent: 'a' }, 1));
    expect(stderrLines.join('')).toContain('Enhancer working');
    expect(stderrLines.join('')).toContain('Round 1 start');
    expect(stderrLines.join('')).toContain('a round 1');
  });

  it('stdout 仍仅 final.md（重定向不污染）', () => {
    const emitter = new EventEmitter();
    const stdoutLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: false,
      verbosity: 'normal',
      stdout: (s) => stdoutLines.push(s),
      stderr: () => {},
    });
    emitter.emit(makeEvent(EventType.RoundStarted, {}, 1));
    emitter.emit(makeEvent(EventType.AgentResponded, { agent: 'a' }, 1));
    emitter.emit(makeEvent(EventType.FinalizedConverged, { markdown: '# Final' }));
    expect(stdoutLines.join('')).toBe('# Final\n');
  });

  it('--no-persist + TUI off → stderr 第一行提示', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: false,
      verbosity: 'normal',
      noPersist: true,
      stdout: () => {},
      stderr: (s) => stderrLines.push(s),
    });
    expect(stderrLines.join('')).toContain('--no-persist');
    expect(stderrLines.join('')).toContain('NOT be written');
  });
});

describe('stdout presenter — verbosity', () => {
  it('quiet 仅 error / abort 输出', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: false,
      verbosity: 'quiet',
      stdout: () => {},
      stderr: (s) => stderrLines.push(s),
    });
    emitter.emit(makeEvent(EventType.RoundStarted, {}, 1));
    emitter.emit(makeEvent(EventType.AgentErrored, { agent: 'a', error: 'timeout' }, 1));
    const out = stderrLines.join('');
    expect(out).not.toContain('Round 1 start');
    expect(out).toContain('agent_errored');
  });

  it('verbose 额外输出 raw_head', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    startStdoutPresenter({
      emitter,
      tuiOn: false,
      verbosity: 'verbose',
      stdout: () => {},
      stderr: (s) => stderrLines.push(s),
    });
    emitter.emit(
      makeEvent(EventType.AgentResponded, { agent: 'a', raw_head: 'first line of answer', duration_ms: 1234 }, 1),
    );
    expect(stderrLines.join('')).toContain('first line of answer');
    expect(stderrLines.join('')).toContain('1234ms');
  });
});

describe('emitStartupInfo', () => {
  it('TUI off + normal → 写 stderr', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    emitStartupInfo({
      emitter,
      tuiOn: false,
      verbosity: 'normal',
      scene: 'consumer',
      activeAgents: ['claude', 'codex'],
      stderr: (s) => stderrLines.push(s),
    });
    expect(stderrLines.join('')).toContain('scene = consumer');
    expect(stderrLines.join('')).toContain('claude, codex');
  });

  it('TUI on → 不写 stderr（由 TUI 渲染）', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    emitStartupInfo({
      emitter,
      tuiOn: true,
      verbosity: 'normal',
      scene: 'consumer',
      activeAgents: ['claude'],
      stderr: (s) => stderrLines.push(s),
    });
    expect(stderrLines).toEqual([]);
  });

  it('quiet → 不写', () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    emitStartupInfo({
      emitter,
      tuiOn: false,
      verbosity: 'quiet',
      scene: 'consumer',
      activeAgents: ['claude'],
      stderr: (s) => stderrLines.push(s),
    });
    expect(stderrLines).toEqual([]);
  });
});
