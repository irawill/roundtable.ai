import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';

/**
 * Shell 自动识别 + rc 文件选择。
 *
 * 来自 §command-alias "Shell 自动识别 + 选 rc 文件" Requirement：
 * - zsh → ~/.zshrc
 * - bash (Linux) → ~/.bashrc
 * - bash (macOS) → ~/.bash_profile（优先；不存在 fallback ~/.bashrc）
 * - fish → ~/.config/fish/config.fish（alias 语法差异，写入侧用 fish 形式）
 * - nushell → ~/.config/nushell/config.nu
 * - 其他 / 未知 → 仅显示要加的行，不自动写入文件
 *
 * Windows：跳过自动写入（仅显示 PowerShell Set-Alias 提示，详见 §command-alias "跨平台兼容"）。
 *
 * 本模块只做**识别**——返回结构化的 ShellKind + rc 文件路径；具体写入与卸载在阶段 7 落地。
 */

export type ShellKind = 'zsh' | 'bash' | 'fish' | 'nushell' | 'unknown' | 'windows';

export interface ShellInfo {
  kind: ShellKind;
  /** rc 文件绝对路径；unknown / windows 为 null */
  rcFile: string | null;
  /** 是否支持自动写入；unknown / windows 为 false */
  autoWritable: boolean;
  /** 平台标识（透传给写入逻辑选择 fallback） */
  platform: NodeJS.Platform;
}

export interface DetectShellInput {
  /** $SHELL env，缺省时从当前进程取 */
  shellEnv?: string | undefined;
  /** 用户 home 目录，默认 os.homedir() */
  home?: string;
  /** 平台标识，默认 os.platform() */
  platform?: NodeJS.Platform;
  /** 文件存在性判定（macOS bash 优先 .bash_profile 但需 fallback 到 .bashrc 时用） */
  fileExists?: (path: string) => boolean;
}

/**
 * 识别 shell 类型与对应的 rc 文件路径。
 *
 * @throws 不会抛错；任何未识别情形返回 kind='unknown'，autoWritable=false
 */
export function detectShell(input: DetectShellInput = {}): ShellInfo {
  const plat = input.platform ?? platform();
  const home = input.home ?? homedir();
  const fileExists = input.fileExists ?? existsSync;

  if (plat === 'win32') {
    return { kind: 'windows', rcFile: null, autoWritable: false, platform: plat };
  }

  const shellPath = input.shellEnv ?? process.env.SHELL ?? '';
  // basename 处理 /bin/zsh / /usr/local/bin/zsh / /opt/homebrew/bin/fish 等
  const shellBin = basename(shellPath);

  if (shellBin === 'zsh') {
    return {
      kind: 'zsh',
      rcFile: join(home, '.zshrc'),
      autoWritable: true,
      platform: plat,
    };
  }

  if (shellBin === 'bash') {
    // macOS 优先 .bash_profile（系统默认），不存在 fallback .bashrc
    // Linux 默认 .bashrc
    if (plat === 'darwin') {
      const profile = join(home, '.bash_profile');
      const rc = join(home, '.bashrc');
      return {
        kind: 'bash',
        rcFile: fileExists(profile) ? profile : rc,
        autoWritable: true,
        platform: plat,
      };
    }
    return {
      kind: 'bash',
      rcFile: join(home, '.bashrc'),
      autoWritable: true,
      platform: plat,
    };
  }

  if (shellBin === 'fish') {
    return {
      kind: 'fish',
      rcFile: join(home, '.config', 'fish', 'config.fish'),
      autoWritable: true,
      platform: plat,
    };
  }

  if (shellBin === 'nu' || shellBin === 'nushell') {
    return {
      kind: 'nushell',
      rcFile: join(home, '.config', 'nushell', 'config.nu'),
      autoWritable: true,
      platform: plat,
    };
  }

  return { kind: 'unknown', rcFile: null, autoWritable: false, platform: plat };
}
