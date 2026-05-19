import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * XDG 路径解析。
 *
 * 来自 §persistence-history "配置目录可移植" + §proposal.md "新增配置目录"：
 * - ~/.config/roundtable.ai/{models,scenes,roles,prefs}.yaml（XDG_CONFIG_HOME 覆盖）
 * - ~/.local/share/roundtable.ai/runs/<uuid>/（XDG_DATA_HOME 覆盖）
 *
 * Windows 用 %APPDATA%（v1 主用户体验在 macOS / Linux，Windows 路径仅做基础兼容）。
 *
 * 注意：路径解析层 MUST NOT 触碰文件系统（只算字符串）；目录创建与权限校验是阶段 6 持久化层的职责。
 */

export interface PathsInput {
  /** 用户 home 目录；默认从 os.homedir() 取。测试可注入 mock 路径。 */
  home?: string;
  /** XDG_CONFIG_HOME env，缺失 fallback 到 ~/.config */
  xdgConfigHome?: string | undefined;
  /** XDG_DATA_HOME env，缺失 fallback 到 ~/.local/share */
  xdgDataHome?: string | undefined;
  /** APPDATA env（Windows），缺失 fallback 到 home */
  appData?: string | undefined;
  /** 平台标识；默认从 os.platform() 取。 */
  platform?: NodeJS.Platform;
}

export interface ConfigPaths {
  /** 配置根目录（含 models.yaml / scenes.yaml / roles.yaml / prefs.yaml / adapters.mjs） */
  configDir: string;
  /** runs/<uuid>/ 的父目录 */
  dataDir: string;
  /** runs 根目录（dataDir/runs） */
  runsDir: string;
  modelsYaml: string;
  scenesYaml: string;
  rolesYaml: string;
  prefsYaml: string;
  /** 用户自加 adapter ESM 模块 */
  adaptersMjs: string;
}

const PROJECT_DIR = 'roundtable.ai';

/**
 * 计算配置与数据目录路径。
 *
 * 优先级（与 XDG Base Directory Specification 一致）：
 * - macOS / Linux：XDG_CONFIG_HOME ?? ~/.config，XDG_DATA_HOME ?? ~/.local/share
 * - Windows：%APPDATA% ?? home（含 Roaming / Local 区分时由用户自己设环境变量）
 */
export function resolveConfigPaths(input: PathsInput = {}): ConfigPaths {
  const home = input.home ?? homedir();
  const plat = input.platform ?? platform();

  const configDir =
    plat === 'win32'
      ? join(input.appData ?? home, PROJECT_DIR)
      : join(input.xdgConfigHome ?? join(home, '.config'), PROJECT_DIR);

  const dataDir =
    plat === 'win32'
      ? join(input.appData ?? home, PROJECT_DIR)
      : join(input.xdgDataHome ?? join(home, '.local', 'share'), PROJECT_DIR);

  const runsDir = join(dataDir, 'runs');

  return {
    configDir,
    dataDir,
    runsDir,
    modelsYaml: join(configDir, 'models.yaml'),
    scenesYaml: join(configDir, 'scenes.yaml'),
    rolesYaml: join(configDir, 'roles.yaml'),
    prefsYaml: join(configDir, 'prefs.yaml'),
    adaptersMjs: join(configDir, 'adapters.mjs'),
  };
}
