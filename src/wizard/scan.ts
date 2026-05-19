import { binaryAvailable } from '../adapters/runtime/binary.js';

/**
 * Wizard PATH 扫描。
 *
 * 来自 §setup-wizard "Wizard 扫描 $PATH 已知 CLI" Requirement + tasks.md §18.2。
 *
 * 两类扫描清单：
 * 1. **3 个内置 adapter 对应 binary**（必扫）：claude / codex / gemini → 进入"启用 model 流程"
 * 2. **常见非内置 binary 名**（可选扫，仅提示接入）：v1 仅 kimi-cli
 *
 * 未来加入新内置 adapter 需同步更新本扫描清单。
 */

export const BUILTIN_CLI_NAMES = ['claude', 'codex', 'gemini'] as const;
export type BuiltinCliName = (typeof BUILTIN_CLI_NAMES)[number];

/** v1 非内置 binary 示例（仅提示用户用 YAML adapter 接入）。 */
export const KNOWN_THIRD_PARTY_CLI_NAMES = ['kimi-cli'] as const;

export interface ScanResult {
  /** 内置 adapter 探测结果：name → installed */
  builtins: Record<BuiltinCliName, boolean>;
  /** 第三方 binary 探测结果：name → installed */
  thirdParty: Record<string, boolean>;
}

export function scanKnownClis(): ScanResult {
  const builtins: Record<BuiltinCliName, boolean> = {
    claude: binaryAvailable({ command: 'claude' }),
    codex: binaryAvailable({ command: 'codex' }),
    gemini: binaryAvailable({ command: 'gemini' }),
  };
  const thirdParty: Record<string, boolean> = {};
  for (const name of KNOWN_THIRD_PARTY_CLI_NAMES) {
    thirdParty[name] = binaryAvailable({ command: name });
  }
  return { builtins, thirdParty };
}

/**
 * 渲染扫描结果为人类可读字符串（用于 wizard 启动时展示）。
 */
export function renderScanReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push('# 扫描已知 CLI');
  lines.push('');
  for (const name of BUILTIN_CLI_NAMES) {
    if (result.builtins[name]) {
      lines.push(`  ✓ ${name} 已安装`);
    } else {
      lines.push(`  ✗ ${name} 未找到（${installHint(name)}）`);
    }
  }
  for (const [name, installed] of Object.entries(result.thirdParty)) {
    if (installed) {
      lines.push(
        `  ℹ ${name} 已安装（非内置 adapter；如需接入请编辑 ~/.config/roundtable.ai/models.yaml）`,
      );
    }
  }
  return lines.join('\n');
}

function installHint(name: BuiltinCliName): string {
  switch (name) {
    case 'claude':
      return 'https://docs.anthropic.com/en/docs/claude-code';
    case 'codex':
      return 'https://github.com/openai/codex';
    case 'gemini':
      return 'https://github.com/google-gemini/gemini-cli';
  }
}
