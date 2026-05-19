import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 用 projects 分 unit / integration 两个工程
    // unit：默认随 npm test 跑，毫秒级
    // integration：依赖真实外部 CLI 或网络，仅在 main 或显式触发时跑
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/integration/**', 'node_modules/**', 'dist/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          // 单测严格上限；integration 走真实 CLI 时另设
          testTimeout: 60_000,
        },
      },
    ],
    // 失败立即 stop 便于 CI 反馈
    bail: 0,
  },
});
