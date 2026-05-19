import { defineConfig } from 'tsup';

export default defineConfig({
  // entry 用对象形式：key 决定输出文件名，避免保留 src/cli/ 目录层级。
  // 输出为 dist/cli.js（与 package.json bin 引用一致；spec §1.1 / §1.4 要求）。
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: false,
  dts: false,
  minify: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // i18n JSON 翻译包通过 import 在编译时一同打包进二进制
  loader: {
    '.json': 'json',
  },
});
