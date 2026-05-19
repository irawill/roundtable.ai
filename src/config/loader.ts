import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { BUILTIN_SCENES } from './defaults/builtin-scenes.js';
import type { ConfigPaths } from './paths.js';
import { ModelsFileSchema, type ModelsFile } from './schemas/models.js';
import { type PrefsFile, PrefsFileSchema, defaultPrefs } from './schemas/prefs.js';
import { RolesFileSchema, type RolesFile } from './schemas/roles.js';
import { ScenesFileSchema, type ScenesFile } from './schemas/scenes.js';

/**
 * 配置加载器与兜底逻辑。
 *
 * 来自 §setup-wizard "兜底缺失配置" Requirement：
 * - models.yaml 缺失 → 报错并提示 rtai setup（不自动生成；用户必须显式选 model）
 * - scenes.yaml 缺失 → 自动写入 v1 内置 7 个 scene + warn
 * - roles.yaml 缺失 → 取启用列表第一个 model 作为 enhancer + executor + warn（本加载层返回 undefined，
 *   由调用方在合并启用列表后决定）
 * - prefs.yaml 缺失 → 写入默认值
 *
 * Schema 校验失败按本规格 + §language-support 的容错策略处理；当前实现：校验失败直接 throw
 * （Zod 错误信息含具体字段路径，便于用户诊断）；后续阶段可加 fallback。
 */

/**
 * Loader 行为可由调用方注入，便于测试：
 * - read：返回 yaml 文本，文件不存在时 throw（含 errno ENOENT）
 * - write：写入 yaml 文本
 * - exists：判断文件是否存在
 * - warn：发出 warn 到 stderr / TUI（默认 console.warn）
 */
export interface LoaderIo {
  read: (path: string) => string;
  write: (path: string, content: string) => void;
  exists: (path: string) => boolean;
  warn: (msg: string) => void;
}

/** 真实 IO（默认实现，写入文件权限 0600）。 */
export const realIo: LoaderIo = {
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  },
  exists: (path) => existsSync(path),
  warn: (msg) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  },
};

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

/**
 * 加载 models.yaml。文件**必须存在**——缺失时抛 ConfigLoadError 并提示 rtai setup。
 *
 * 不自动生成默认 models.yaml（不像 scenes.yaml）：内置 adapter 启用与否必须经用户显式决定，
 * 默认不启用任何 model 会导致后续 Layer 1 = 0 abort，体验不可接受。
 */
export function loadModels(paths: ConfigPaths, io: LoaderIo = realIo): ModelsFile {
  if (!io.exists(paths.modelsYaml)) {
    throw new ConfigLoadError(
      `models.yaml 不存在：${paths.modelsYaml}\n请运行 \`rtai setup\` 完成首次配置。`,
    );
  }
  const text = io.read(paths.modelsYaml);
  const parsed = yamlParse(text);
  const result = ModelsFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(`models.yaml 校验失败：\n${formatZodError(result.error)}`);
  }
  return result.data;
}

/**
 * 加载 scenes.yaml。
 *
 * 缺失文件 → 自动按 v1 内置 7 个 canonical scene 写入 + warn（§setup-wizard 兜底缺失配置）。
 * 用户自定义 scene 通过编辑 scenes.yaml 添加；本加载器返回的对象含全部 scene（内置 + 自定义）。
 */
export function loadScenes(paths: ConfigPaths, io: LoaderIo = realIo): ScenesFile {
  if (!io.exists(paths.scenesYaml)) {
    io.warn(
      `scenes.yaml 不存在：${paths.scenesYaml}\n已自动写入 v1 内置 7 个 scene 作为默认；可手动编辑后启用自定义。`,
    );
    const yamlText = yamlStringify(BUILTIN_SCENES);
    io.write(paths.scenesYaml, yamlText);
    return BUILTIN_SCENES;
  }
  const text = io.read(paths.scenesYaml);
  const parsed = yamlParse(text);
  const result = ScenesFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(`scenes.yaml 校验失败：\n${formatZodError(result.error)}`);
  }
  return result.data;
}

/**
 * 加载 roles.yaml。
 *
 * 缺失文件 → 返回 undefined（**不**自动写入）。调用方应在合并 models 列表后取启用列表第一个
 * model 作为 enhancer + executor + warn（详见 §setup-wizard "兜底缺失配置" Requirement）。
 *
 * 这种"延迟决定"是有意的：本加载层不知道启用列表，把这个责任留给上层 config 合并器。
 */
export function loadRoles(paths: ConfigPaths, io: LoaderIo = realIo): RolesFile | undefined {
  if (!io.exists(paths.rolesYaml)) {
    io.warn(
      `roles.yaml 不存在：${paths.rolesYaml}\n将取已启用 model 列表第一个作为 enhancer + executor；建议运行 \`rtai config roles\`。`,
    );
    return undefined;
  }
  const text = io.read(paths.rolesYaml);
  const parsed = yamlParse(text);
  const result = RolesFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(`roles.yaml 校验失败：\n${formatZodError(result.error)}`);
  }
  return result.data;
}

/**
 * 加载 prefs.yaml。
 *
 * 缺失文件 → 自动写入默认值 + warn（§setup-wizard 兜底缺失配置）。
 * 校验失败 → throw（含字段路径，便于用户定位）。
 */
export function loadPrefs(paths: ConfigPaths, io: LoaderIo = realIo): PrefsFile {
  if (!io.exists(paths.prefsYaml)) {
    const prefs = defaultPrefs();
    const yamlText = yamlStringify(prefs);
    io.write(paths.prefsYaml, yamlText);
    io.warn(`prefs.yaml 不存在：${paths.prefsYaml}\n已写入默认值。`);
    return prefs;
  }
  const text = io.read(paths.prefsYaml);
  const parsed = yamlParse(text);
  const result = PrefsFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(`prefs.yaml 校验失败：\n${formatZodError(result.error)}`);
  }
  return result.data;
}

/**
 * 把 Zod 错误格式化为人类可读字符串（含 path + message）。
 *
 * Zod v4 issue.path 类型是 `PropertyKey[]`（含 symbol），用 String() 安全转换 segment。
 */
function formatZodError(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues
    .map((iss) => `- ${iss.path.map((s) => String(s)).join('.')}: ${iss.message}`)
    .join('\n');
}
