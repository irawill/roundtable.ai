import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnAndCollect, SpawnError } from '../../../src/adapters/runtime/spawn.js';

const HELPER_PATH = join(tmpdir(), `rtai-spawn-helper-${process.pid}.mjs`);

/**
 * 测试 helper：一个简单的 Node 脚本，根据 env 变量行为不同：
 * - RTAI_TEST_MODE=stdin_echo：从 stdin 读所有 → stdout 输出 "got:<content>" → exit 0
 * - RTAI_TEST_MODE=argv_echo：把 argv 拼回 stdout → exit 0
 * - RTAI_TEST_MODE=tmpfile_read：把 argv[2]（被 prompt_file 替换）当文件路径读 → stdout 输出内容
 * - RTAI_TEST_MODE=fail：stderr 输出 "auth error 401 unauthorized" → exit 2
 * - RTAI_TEST_MODE=slow：sleep 2 秒后 exit 0（用于 timeout 测试）
 */
beforeAll(() => {
  const helper = `
import { readFileSync } from 'node:fs';
const mode = process.env.RTAI_TEST_MODE;
const argv = process.argv.slice(2);

if (mode === 'stdin_echo') {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c.toString('utf8'); });
  process.stdin.on('end', () => {
    process.stdout.write('got:' + buf);
    process.exit(0);
  });
} else if (mode === 'argv_echo') {
  process.stdout.write('argv:' + JSON.stringify(argv));
  process.exit(0);
} else if (mode === 'tmpfile_read') {
  // tmpfile 占位符 {prompt_file} 被 spawn 替换为临时文件绝对路径，是 argv[0]
  const path = argv[0];
  const content = readFileSync(path, 'utf8');
  process.stdout.write('file:' + content);
  process.exit(0);
} else if (mode === 'fail') {
  process.stderr.write('auth error 401 unauthorized');
  process.exit(2);
} else if (mode === 'slow') {
  setTimeout(() => process.exit(0), 2000);
} else {
  process.stderr.write('unknown mode: ' + mode);
  process.exit(1);
}
`;
  writeFileSync(HELPER_PATH, helper, { encoding: 'utf8', mode: 0o600 });
});

afterAll(() => {
  try {
    unlinkSync(HELPER_PATH);
  } catch {
    // ignore
  }
});

describe('spawnAndCollect — stdin mode（默认）', () => {
  it('prompt 通过 stdin 传递，argv 不含 prompt', async () => {
    const r = await spawnAndCollect({
      command: process.execPath, // node
      args: [HELPER_PATH],
      prompt: 'hello stdin',
      transport: 'stdin',
      timeoutMs: 5000,
      env: { ...process.env, RTAI_TEST_MODE: 'stdin_echo' },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('got:hello stdin');
  });
});

describe('spawnAndCollect — tmpfile mode', () => {
  it('替换 {prompt_file} 占位符为临时文件路径，并自动 unlink', async () => {
    const r = await spawnAndCollect({
      command: process.execPath,
      args: [HELPER_PATH, '{prompt_file}'],
      prompt: 'hello tmpfile',
      transport: 'tmpfile',
      timeoutMs: 5000,
      env: { ...process.env, RTAI_TEST_MODE: 'tmpfile_read' },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('file:hello tmpfile');
  });

  it('tmpfile 目录在 invoke 结束后被清理（try/finally 保证）', async () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('rtai-prompt-'));
    await spawnAndCollect({
      command: process.execPath,
      args: [HELPER_PATH, '{prompt_file}'],
      prompt: 'hi',
      transport: 'tmpfile',
      timeoutMs: 5000,
      env: { ...process.env, RTAI_TEST_MODE: 'tmpfile_read' },
    });
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('rtai-prompt-'));
    // invoke 完成后 rtai-prompt-* 目录数应回到 before 的水平
    expect(after.length).toBe(before.length);
  });
});

describe('spawnAndCollect — argv mode + 4KB 上限', () => {
  it('短 prompt 通过 argv 传递', async () => {
    const r = await spawnAndCollect({
      command: process.execPath,
      args: [HELPER_PATH],
      prompt: 'short',
      transport: 'argv',
      timeoutMs: 5000,
      env: { ...process.env, RTAI_TEST_MODE: 'argv_echo' },
    });
    expect(r.exitCode).toBe(0);
    // argv echo 会把 HELPER_PATH 之后的 args 全部返回（包含 prompt）
    expect(r.stdout).toContain('short');
  });

  it('prompt > 4KB 时拒绝并 throw SpawnError', async () => {
    const longPrompt = 'a'.repeat(4097);
    await expect(
      spawnAndCollect({
        command: process.execPath,
        args: [HELPER_PATH],
        prompt: longPrompt,
        transport: 'argv',
        timeoutMs: 5000,
        env: { ...process.env, RTAI_TEST_MODE: 'argv_echo' },
      }),
    ).rejects.toThrow(SpawnError);
  });

  it('prompt 恰好 4KB（边界）允许', async () => {
    const exactlyLimit = 'a'.repeat(4096);
    const r = await spawnAndCollect({
      command: process.execPath,
      args: [HELPER_PATH],
      prompt: exactlyLimit,
      transport: 'argv',
      timeoutMs: 5000,
      env: { ...process.env, RTAI_TEST_MODE: 'argv_echo' },
    });
    expect(r.exitCode).toBe(0);
  });
});

describe('spawnAndCollect — exit code 与 stderr', () => {
  it('exit 非 0 时仍返回，timedOut=false', async () => {
    const r = await spawnAndCollect({
      command: process.execPath,
      args: [HELPER_PATH],
      prompt: '',
      transport: 'stdin',
      timeoutMs: 5000,
      env: { ...process.env, RTAI_TEST_MODE: 'fail' },
    });
    expect(r.exitCode).toBe(2);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).toContain('401');
  });
});

describe('spawnAndCollect — timeout', () => {
  it('超时后 timedOut=true', async () => {
    const r = await spawnAndCollect({
      command: process.execPath,
      args: [HELPER_PATH],
      prompt: '',
      transport: 'stdin',
      timeoutMs: 200, // 200ms（slow 模式 sleep 2s）
      env: { ...process.env, RTAI_TEST_MODE: 'slow' },
    });
    expect(r.timedOut).toBe(true);
    // exit code 可能 null（SIGTERM kill）或 1，取决于 helper 是否抓 signal
    expect(r.exitCode === null || r.exitCode !== 0).toBe(true);
  }, 10_000);
});

describe('spawnAndCollect — spawn 失败', () => {
  it('binary 不存在 → SpawnError', async () => {
    await expect(
      spawnAndCollect({
        command: '/non/existent/binary',
        args: [],
        prompt: '',
        transport: 'stdin',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();
  });
});
