import { chmodSync, existsSync } from 'node:fs';
import { stringify as yamlStringify } from 'yaml';
import { detectOccupancy } from '../alias/detect.js';
import { detectShell } from '../alias/shell.js';
import { writeAliasToRc } from '../alias/write.js';
import type { ConfigPaths } from '../config/paths.js';
import { defaultPrefs, type PrefsFile } from '../config/schemas/prefs.js';
import {
  ensureSecureDir,
  SECURE_FILE_MODE,
} from '../persistence/permissions.js';
import { realIo, type LoaderIo } from '../config/loader.js';
import { BUILTIN_SCENES } from '../config/defaults/builtin-scenes.js';
import {
  type BuiltinCliName,
  scanKnownClis,
  renderScanReport,
  BUILTIN_CLI_NAMES,
} from './scan.js';
import { resolveLang } from '../shared/lang/alias.js';
import { deriveSystemLanguage } from '../shared/lang/system-language.js';

/**
 * Setup Wizard 主流程。
 *
 * 来自 §setup-wizard 全部 Requirements + §command-alias "可选 `rt` 短别名" + tasks.md §18.1-§18.9 §19.2 §19.3。
 *
 * Wizard 流程：
 * 1. 检测 ~/.config/roundtable.ai/ 存在性 → 自动触发判定
 * 2. PATH 扫描已知 CLI（3 个内置必扫 + kimi-cli 仅提示）
 * 3. 对每个发现的内置 CLI：询问启用 + 鉴权预检 + version + effort
 * 4. 角色选择（enhancer / executor，按 suitability 排序 + rotate 选项）
 *    单 model 自动设角色；0 model 拒绝完成
 * 5. 语言选择（10 内置 + auto + system + $LANG 预选）
 * 6. Alias 末尾步骤（rtai default native + 可选 rt 短别名 / rtai 冲突走主名兜底）
 *
 * v0.1.0 简化：本模块接受 input function 注入（便于测试与未来 ink 集成）；
 * 真正的 TUI / readline 交互在阶段 7 主入口装配时接入。
 *
 * 接口设计：runWizard 接受 prompt 回调（async question → string answer）+ io；
 * 返回最终写入的 prefs / models / roles 结构供调用方决定后续动作。
 */

export interface WizardPromptFn {
  /** 提问：返回用户输入字符串（去掉首尾空白） */
  ask: (prompt: string) => Promise<string>;
  /** 单字符 Y/n 风格确认（接受 y/Y 视为 true，其他视为 false） */
  confirm: (prompt: string) => Promise<boolean>;
  /** 单选项菜单：返回用户选择 idx；超出范围时重问 */
  choose: (prompt: string, options: readonly string[]) => Promise<number>;
}

export interface WizardArgs {
  paths: ConfigPaths;
  prompt: WizardPromptFn;
  /** 是否覆盖已有配置（rtai setup 重跑入口） */
  rerun?: boolean;
  /** stderr 写（warn / 提示用） */
  stderr?: (s: string) => void;
  /** env override（测试用） */
  env?: NodeJS.ProcessEnv;
  /** io override（测试用） */
  io?: LoaderIo;
}

export interface WizardResult {
  /** 启用的 model 名 → 配置块（写入 models.yaml） */
  enabledModels: Record<string, Record<string, unknown>>;
  /** roles.yaml 配置 */
  roles: { enhancer: { mode: 'fixed'; model: string }; executor: { mode: string; model?: string } };
  /** prefs.yaml 配置（含 cli alias 结果） */
  prefs: PrefsFile;
  /** 用户原始问题（如果首次启动时由 CLI 传入） */
  originalQuestion?: string;
}

export class WizardCancelledError extends Error {
  constructor(message = 'wizard cancelled by user') {
    super(message);
    this.name = 'WizardCancelledError';
  }
}

/** 是否需要自动触发 wizard：~/.config/roundtable.ai/prefs.yaml 不存在则触发。 */
export function shouldAutoTriggerWizard(paths: ConfigPaths): boolean {
  return !existsSync(paths.prefsYaml);
}

/**
 * 主入口。
 *
 * 返回的 WizardResult 已经写入了 4 个 yaml 文件；调用方根据需要继续走原问题流程。
 */
export async function runWizard(args: WizardArgs): Promise<WizardResult> {
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));
  const env = args.env ?? process.env;
  const io = args.io ?? realIo;

  // 步骤 1：扫描
  const scan = scanKnownClis();
  stderr(renderScanReport(scan) + '\n\n');

  // 步骤 2：启用 model（v0.1.0 简化：只问"是否启用"，version/effort 用 wizard 默认）
  const enabledModels: Record<string, Record<string, unknown>> = {};
  for (const name of BUILTIN_CLI_NAMES) {
    if (!scan.builtins[name]) continue;
    const yes = await args.prompt.confirm(`启用 ${name}？(Y/n) `);
    if (!yes) continue;
    enabledModels[name] = buildBuiltinModelConfig(name);
  }

  if (Object.keys(enabledModels).length === 0) {
    throw new WizardCancelledError('未启用任何 model，wizard 拒绝完成（至少需要 1 个 model）');
  }

  // 步骤 3：角色选择
  const enabledList = Object.keys(enabledModels);
  let enhancerModel: string;
  let executorModel: string;
  let executorMode: 'fixed' | 'rotate' | 'random' | 'per_scene' = 'fixed';

  if (enabledList.length === 1) {
    // 单 model 自动设角色
    enhancerModel = enabledList[0]!;
    executorModel = enabledList[0]!;
    stderr(`已自动把 ${enhancerModel} 设为 enhancer + executor\n`);
  } else {
    const ei = await args.prompt.choose('选择 enhancer model：', enabledList);
    enhancerModel = enabledList[ei]!;
    const executorOptions = [...enabledList, 'rotate', 'random'];
    const xi = await args.prompt.choose('选择 executor mode：', executorOptions);
    const choice = executorOptions[xi]!;
    if (choice === 'rotate' || choice === 'random') {
      executorMode = choice;
      executorModel = '';
    } else {
      executorMode = 'fixed';
      executorModel = choice;
    }
  }

  // 步骤 4：语言选择
  const systemLang = deriveSystemLanguage(env);
  const langOptions = [
    `system (跟随系统 $LANG → ${systemLang}) — 推荐`,
    'auto (由 Enhancer 检测问题语言)',
    'zh-Hans (简体中文)',
    'en (English)',
    'ja (日本語)',
    'ko (한국어)',
    'zh-Hant (繁體中文)',
    'es (Español)',
    'fr (Français)',
    'de (Deutsch)',
    'pt-BR (Português Brasil)',
    'ru (Русский)',
  ];
  const li = await args.prompt.choose('选择输出语言：', langOptions);
  const langChoice = langOptions[li]!.split(' ')[0]!;
  const resolved = resolveLang(langChoice);
  const outputLang =
    resolved.kind === 'keyword' ? resolved.value : resolved.kind === 'bcp47' ? resolved.value : 'auto';

  // 步骤 5：构造 prefs（含 alias 末尾步骤）
  const prefs = defaultPrefs();
  prefs.language.output = outputLang;

  // 步骤 6：alias 末尾步骤
  const shellInfo = detectShell({ shellEnv: env.SHELL, platform: process.platform });
  await runAliasStep(prefs, shellInfo, args.prompt, stderr);

  // 写入 4 个 yaml + roles 文件
  ensureSecureDir(args.paths.configDir);

  io.write(args.paths.modelsYaml, yamlStringify({ models: enabledModels }));
  io.write(args.paths.scenesYaml, yamlStringify(BUILTIN_SCENES));

  const rolesYaml = {
    enhancer: { mode: 'fixed' as const, model: enhancerModel },
    executor:
      executorMode === 'fixed'
        ? { mode: 'fixed' as const, model: executorModel }
        : { mode: executorMode },
  };
  io.write(args.paths.rolesYaml, yamlStringify(rolesYaml));
  io.write(args.paths.prefsYaml, yamlStringify(prefs));

  // 收紧文件权限（io.write 已带 0600 但保险起见）
  for (const path of [
    args.paths.modelsYaml,
    args.paths.scenesYaml,
    args.paths.rolesYaml,
    args.paths.prefsYaml,
  ]) {
    try {
      chmodSync(path, SECURE_FILE_MODE);
    } catch {
      // ignore（io.write 已带 0600 mode；这里 chmod 是冗余保险）
    }
  }

  return {
    enabledModels,
    roles: rolesYaml,
    prefs,
  };
}

/**
 * Alias 末尾步骤（来自 §command-alias 全 Requirements）：
 * - 检测 rtai / rt 占用状态
 * - 默认情形（rtai native + rt 未占）→ 询问是否设短别名
 * - rt 已占用 → 跳过短别名
 * - rtai 已占用 → 走主名兜底（候选 rta / rtab / rdt / 自定义）
 * - 主名走兜底时**不**再叠加短别名
 */
async function runAliasStep(
  prefs: PrefsFile,
  shellInfo: ReturnType<typeof detectShell>,
  prompt: WizardPromptFn,
  stderr: (s: string) => void,
): Promise<void> {
  if (shellInfo.kind === 'windows' || shellInfo.kind === 'unknown' || shellInfo.rcFile === null) {
    stderr(
      `(检测到 shell=${shellInfo.kind}，跳过 alias 自动写入；可手动添加：alias rtai=...)\n`,
    );
    prefs.cli.primary_status = 'native';
    prefs.cli.short_alias_status = 'skipped';
    return;
  }

  // 检测 rtai 占用
  const rtaiOcc = detectOccupancy({ name: 'rtai', rcFile: shellInfo.rcFile });
  let rtaiOccupied =
    rtaiOcc.kind === 'occupied_by_path' || rtaiOcc.kind === 'occupied_by_rc';

  // 假设 rtai 是 npm bin 投放，本身在 PATH 中 → occupied_by_path 命中 self；
  // 简化处理：仅当 rtai 在 PATH 但不是 npm 投放的（启发式：路径不含 node_modules / npm）时视为冲突。
  if (rtaiOcc.kind === 'occupied_by_path') {
    const path = rtaiOcc.path.toLowerCase();
    if (path.includes('node_modules') || path.includes('npm') || path.includes('homebrew')) {
      rtaiOccupied = false; // 是 npm / homebrew 自己投放的
    }
  }

  if (rtaiOccupied) {
    // 主名兜底
    stderr(`⚠ rtai 命令已被占用（${describeOccupancy(rtaiOcc)}），进入主名兜底\n`);
    const candidates = ['rta', 'rtab', 'rdt'];
    const idx = await prompt.choose('选择主名兜底候选：', candidates);
    const fallbackName = candidates[idx]!;
    // 写入 rc
    const target = process.execPath; // 用 node 路径占位；实际应当用 npm bin 解析路径
    writeAliasToRc({
      rcFile: shellInfo.rcFile,
      shell: shellInfo.kind,
      name: fallbackName,
      target,
      kind: 'primary_fallback',
    });
    prefs.cli.primary_name = fallbackName;
    prefs.cli.primary_status = 'aliased';
    prefs.cli.primary_written_to = shellInfo.rcFile;
    // 主名走兜底时不再叠加短别名
    prefs.cli.short_alias_status = 'skipped';
    return;
  }

  // rtai native：检测 rt 占用
  prefs.cli.primary_status = 'native';
  const rtOcc = detectOccupancy({ name: 'rt', rcFile: shellInfo.rcFile });
  if (rtOcc.kind === 'occupied_by_path' || rtOcc.kind === 'occupied_by_rc') {
    stderr(`ℹ rt 已被占用（${describeOccupancy(rtOcc)}），跳过短别名设置\n`);
    prefs.cli.short_alias_status = 'skipped';
    return;
  }

  // 询问是否设短别名
  const wantShort = await prompt.confirm("要不要给 'rtai' 加一个更短的别名 'rt'？(Y/n) ");
  if (!wantShort) {
    prefs.cli.short_alias_status = 'declined';
    return;
  }
  const target = process.execPath;
  writeAliasToRc({
    rcFile: shellInfo.rcFile,
    shell: shellInfo.kind,
    name: 'rt',
    target,
    kind: 'short',
  });
  prefs.cli.short_alias = 'rt';
  prefs.cli.short_alias_status = 'native';
  prefs.cli.short_alias_written_to = shellInfo.rcFile;
}

function describeOccupancy(occ: ReturnType<typeof detectOccupancy>): string {
  switch (occ.kind) {
    case 'occupied_by_path':
      return `PATH: ${occ.path}`;
    case 'occupied_by_rc':
      return `rc 文件含 ${occ.line.slice(0, 60)}`;
    case 'managed_by_us':
      return `已设过 (${occ.markerKind})`;
    case 'free':
      return 'free';
  }
}

/**
 * 为内置 adapter 构造最小可用的 models.yaml 条目。
 *
 * 注：内置 adapter 的 effort_mapping / capabilities / role_suitability 等运行时由
 * src/adapters/builtins/index.ts 提供 defaults；models.yaml 仅记录用户可调字段（enabled / version / effort）。
 */
function buildBuiltinModelConfig(name: BuiltinCliName): Record<string, unknown> {
  return {
    enabled: true,
    effort: 'medium',
    role_suitability:
      name === 'gemini'
        ? { enhancer: 'medium', executor: 'high' }
        : { enhancer: 'high', executor: 'high' },
  };
}

/** 仅暴露给单测：构造一个内存 WizardPromptFn。 */
export function createScriptedPromptFn(
  responses: { ask?: string[]; confirm?: boolean[]; choose?: number[] },
): WizardPromptFn {
  const askQueue = [...(responses.ask ?? [])];
  const confirmQueue = [...(responses.confirm ?? [])];
  const chooseQueue = [...(responses.choose ?? [])];
  return {
    ask: async () => askQueue.shift() ?? '',
    confirm: async () => confirmQueue.shift() ?? false,
    choose: async (_p, options) => {
      const idx = chooseQueue.shift();
      if (idx === undefined || idx < 0 || idx >= options.length) return 0;
      return idx;
    },
  };
}

export { BUILTIN_CLI_NAMES };
