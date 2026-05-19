import { resolveConfigPaths, type ConfigPaths } from '../config/paths.js';
import { realIo, loadModels, loadPrefs, loadRoles, loadScenes } from '../config/loader.js';
import { shouldAutoTriggerWizard } from '../wizard/index.js';
import type { GlobalOptions } from './options.js';
import { CliError, ExitCode } from './errors.js';

/**
 * 入口路由 + Orchestrator 装配（高层骨架）。
 *
 * 来自 §roundtable-orchestrator "状态机驱动" + §scene-system "两层路径分支" + tasks.md §20.2 §8.4。
 *
 * v0.1.0 设计：本模块负责**装配** —— 把阶段 1-6 的各模块拼成可调用的高层入口。
 * 完整的"一键运行整个 run"端到端流程（含 TUI 交互 / Persistence / Round loop 装配）
 * 留阶段 8 E2E 集成测时由本模块基础上扩展（v0.1.0 candidate 发布前完整跑通需要真实 CLI）。
 *
 * 本模块产出的 routeQuestion(args) 仅做：
 * 1. 首次启动 → wizard 自动触发判定
 * 2. 加载配置（models / scenes / roles / prefs）
 * 3. Layer 1 粗分支（enabled_models.length 0/1/>=2）
 * 4. 返回结构化决策给主入口；主入口决定调用哪条路径
 *
 * 真正的 round loop / Enhancer / Finalizer 装配在主入口 main() 中按本模块返回的决策进行。
 */

import { decideLayer1, type Layer1Decision } from '../orchestrator/branching.js';
import type { ModelsFile } from '../config/schemas/models.js';
import type { ScenesFile } from '../config/schemas/scenes.js';
import type { RolesFile } from '../config/schemas/roles.js';
import type { PrefsFile } from '../config/schemas/prefs.js';

export type RouteDecision =
  | { kind: 'wizard_first_run' }
  | { kind: 'abort_empty'; reason: string }
  | {
      kind: 'single_agent_direct';
      theOnlyAgent: string;
      configs: LoadedConfigs;
    }
  | {
      kind: 'enhance_then_layer2';
      enabledModelNames: string[];
      configs: LoadedConfigs;
    };

export interface LoadedConfigs {
  paths: ConfigPaths;
  models: ModelsFile;
  scenes: ScenesFile;
  roles: RolesFile | undefined;
  prefs: PrefsFile;
}

export interface RouteArgs {
  /** 用户问题（位置参数）；可为空（如仅跑 rtai setup） */
  question?: string;
  globalOptions: GlobalOptions;
  /** 注入路径（测试用），缺省取 resolveConfigPaths() */
  paths?: ConfigPaths;
  /** 注入 io（测试用） */
  env?: NodeJS.ProcessEnv;
}

/**
 * 顶层路由：首次 → wizard；正常 → Layer 1 分支。
 *
 * 不抛 wizard 错误（首次走 wizard 是正常路径）；其他错误（如 models.yaml 损坏）抛 CliError。
 */
/**
 * 加载 models / scenes / roles / prefs 四份配置文件。
 *
 * 子命令（如 `rtai followup`）共享此 helper；主 ask 路径走 routeQuestion 内的同一份加载逻辑。
 */
export function loadAllConfigs(paths: ConfigPaths): LoadedConfigs {
  try {
    const models = loadModels(paths, realIo);
    const scenes = loadScenes(paths, realIo);
    const roles = loadRoles(paths, realIo);
    const prefs = loadPrefs(paths, realIo);
    return { paths, models, scenes, roles, prefs };
  } catch (err) {
    throw new CliError(
      `配置加载失败：${(err as Error).message}`,
      ExitCode.ConfigError,
      '运行 `rtai setup` 重新配置',
    );
  }
}

export function routeQuestion(args: RouteArgs): RouteDecision {
  const paths = args.paths ?? resolveConfigPaths();

  if (shouldAutoTriggerWizard(paths)) {
    return { kind: 'wizard_first_run' };
  }

  const configs: LoadedConfigs = loadAllConfigs(paths);

  // Layer 1 粗分支
  const enabledNames = Object.entries(configs.models.models)
    .filter(([, cfg]) => cfg.enabled === true)
    .map(([name]) => name);

  const decision: Layer1Decision = decideLayer1(enabledNames);
  switch (decision.kind) {
    case 'abort_empty':
      return {
        kind: 'abort_empty',
        reason: '未启用任何 model；运行 `rtai config models enable <name>` 或 `rtai setup`',
      };
    case 'single_agent_direct':
      return {
        kind: 'single_agent_direct',
        theOnlyAgent: decision.theOnlyAgent,
        configs,
      };
    case 'enhance':
      return {
        kind: 'enhance_then_layer2',
        enabledModelNames: enabledNames,
        configs,
      };
  }
}
