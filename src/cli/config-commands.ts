import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type { ConfigPaths } from '../config/paths.js';
import { ModelsFileSchema, type ModelsFile } from '../config/schemas/models.js';
import { PrefsFileSchema, type PrefsFile } from '../config/schemas/prefs.js';
import { RolesFileSchema, type RolesFile } from '../config/schemas/roles.js';
import { ScenesFileSchema, type ScenesFile } from '../config/schemas/scenes.js';
import {
  buildLanguageList,
  buildLanguageShow,
  normalizeFallbackLang,
  normalizeLangForPrefs,
  normalizeUiLang,
} from '../lang/meta.js';
import { CliError, ExitCode } from './errors.js';
import { EFFORT_LEVELS } from '../config/effort.js';
import { unsetAliasFromRc } from '../alias/write.js';
import { detectOccupancy } from '../alias/detect.js';
import { detectShell } from '../alias/shell.js';

/**
 * rtai config 子命令套。
 *
 * 来自 §setup-wizard "`rtai config` 子命令全套（scriptable）" + §language-support "配置子命令"
 * + §command-alias "rtai config alias 子命令" + tasks.md §18.11 §16.13 §19.7 §19.8。
 *
 * 命令树：
 *   rtai config models {list,add,remove,enable,disable,version,effort,auth,check}
 *   rtai config scenes {list,show,add}
 *   rtai config roles {enhancer,executor}
 *   rtai config language {show,list,set,set ui,set fallback,reset}
 *   rtai config alias / alias set short / alias unset short / alias set primary / alias unset primary / alias check
 */

export interface ConfigCmdContext {
  paths: ConfigPaths;
  /** stdout 写函数（默认 process.stdout.write） */
  stdout?: (s: string) => void;
  /** stderr 写函数 */
  stderr?: (s: string) => void;
}

export function buildConfigCommand(ctx: ConfigCmdContext): Command {
  const stdout = ctx.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = ctx.stderr ?? ((s: string) => process.stderr.write(s));

  const config = new Command('config').description('manage roundtable.ai configuration');

  // ─── models ───
  const models = new Command('models');
  models
    .command('list')
    .description('list configured models')
    .action(() => {
      const m = loadModels(ctx.paths);
      for (const [name, cfg] of Object.entries(m.models)) {
        const enabledMark = cfg.enabled ? '✓' : '✗';
        stdout(`${enabledMark} ${name}${cfg.version ? ` (${cfg.version})` : ''}\n`);
      }
    });
  models
    .command('enable <name>')
    .description('enable a model')
    .action((name: string) => {
      const m = loadModels(ctx.paths);
      if (m.models[name] === undefined) throw new CliError(`model "${name}" not configured; add it to models.yaml first`, ExitCode.ConfigError);
      m.models[name]!.enabled = true;
      saveModels(ctx.paths, m);
      stdout(`✓ ${name} enabled\n`);
    });
  models
    .command('disable <name>')
    .description('disable a model')
    .action((name: string) => {
      const m = loadModels(ctx.paths);
      if (m.models[name] === undefined) throw new CliError(`model "${name}" not configured`, ExitCode.ConfigError);
      m.models[name]!.enabled = false;
      saveModels(ctx.paths, m);
      stdout(`✓ ${name} disabled\n`);
    });
  models
    .command('effort <name> <level>')
    .description('set effort level for a model')
    .action((name: string, level: string) => {
      if (!(EFFORT_LEVELS as readonly string[]).includes(level)) {
        throw new CliError(
          `invalid effort "${level}"; valid: ${EFFORT_LEVELS.join(' / ')}`,
          ExitCode.UsageError,
        );
      }
      const m = loadModels(ctx.paths);
      if (m.models[name] === undefined) throw new CliError(`model "${name}" not configured`, ExitCode.ConfigError);
      m.models[name]!.effort = level as 'none' | 'low' | 'medium' | 'high' | 'max';
      saveModels(ctx.paths, m);
      stdout(`✓ ${name}.effort = ${level}\n`);
    });
  models
    .command('version <name> <version-id>')
    .description('set version for a model')
    .action((name: string, versionId: string) => {
      const m = loadModels(ctx.paths);
      if (m.models[name] === undefined) throw new CliError(`model "${name}" not configured`, ExitCode.ConfigError);
      m.models[name]!.version = versionId;
      saveModels(ctx.paths, m);
      stdout(`✓ ${name}.version = ${versionId}\n`);
    });
  models
    .command('auth <name> [credential]')
    .description('show re-auth instructions (does NOT store credentials)')
    .action((name: string, credential?: string) => {
      if (credential !== undefined) {
        // 来自 §security-privacy "凭据零存储" + tasks.md §20.5.11
        throw new CliError(
          'roundtable.ai 不存储凭据；请通过对应 CLI（如 claude login）管理',
          ExitCode.UsageError,
        );
      }
      stdout(`请在另一个终端运行 ${name} 的登录命令（参见 \`rtai config models check ${name}\`）\n`);
    });

  config.addCommand(models);

  // ─── scenes ───
  const scenes = new Command('scenes');
  scenes
    .command('list')
    .description('list configured scenes')
    .action(() => {
      const s = loadScenes(ctx.paths);
      for (const [name, scene] of Object.entries(s.scenes)) {
        stdout(`${name}: ${scene.description}\n`);
      }
    });
  scenes
    .command('show <name>')
    .description('show a scene config')
    .action((name: string) => {
      const s = loadScenes(ctx.paths);
      if (s.scenes[name] === undefined) throw new CliError(`scene "${name}" not found`, ExitCode.ConfigError);
      stdout(yamlStringify({ [name]: s.scenes[name] }));
    });

  config.addCommand(scenes);

  // ─── roles ───
  const roles = new Command('roles');
  roles
    .command('enhancer <model>')
    .description('set enhancer model')
    .action((model: string) => {
      const r = loadRolesOrDefault(ctx.paths);
      r.enhancer = { mode: 'fixed', model };
      saveRoles(ctx.paths, r);
      stdout(`✓ enhancer = ${model}\n`);
    });
  roles
    .command('executor <spec>')
    .description('set executor (model | rotate | random)')
    .action((spec: string) => {
      const r = loadRolesOrDefault(ctx.paths);
      if (spec === 'rotate' || spec === 'random') {
        r.executor = { mode: spec };
      } else {
        r.executor = { mode: 'fixed', model: spec };
      }
      saveRoles(ctx.paths, r);
      stdout(`✓ executor = ${spec}\n`);
    });

  config.addCommand(roles);

  // ─── language ───
  const lang = new Command('language');
  lang
    .command('show')
    .description('show current language config')
    .action(() => {
      const p = loadPrefs(ctx.paths);
      stdout(buildLanguageShow({
        system: 'system',
        requested_output: p.language.output,
        resolved_output: p.language.output,
        resolved_ui: p.language.ui,
        source: 'user_pref',
        confidence: null,
        fallback_used: false,
      }) + '\n');
    });
  lang
    .command('list')
    .description('list builtin translation packs + alias hints')
    .action(() => {
      stdout(buildLanguageList() + '\n');
    });
  lang
    .command('set <value>')
    .description('set output language (auto | system | BCP-47 | alias)')
    .action((value: string) => {
      const r = normalizeLangForPrefs(value);
      if (r.kind === 'error') throw new CliError(r.message, ExitCode.UsageError);
      const p = loadPrefs(ctx.paths);
      p.language.output = r.value;
      savePrefs(ctx.paths, p);
      stdout(`✓ language.output = ${r.value}\n`);
    });
  lang
    .command('set-ui <value>')
    .description('set UI language (system | match_output | BCP-47)')
    .action((value: string) => {
      const r = normalizeUiLang(value);
      if (r.kind === 'error') throw new CliError(r.message, ExitCode.UsageError);
      const p = loadPrefs(ctx.paths);
      p.language.ui = r.value;
      savePrefs(ctx.paths, p);
      stdout(`✓ language.ui = ${r.value}\n`);
    });
  lang
    .command('set-fallback <value>')
    .description('set fallback language (must be a builtin BCP-47)')
    .action((value: string) => {
      const r = normalizeFallbackLang(value);
      if (r.kind === 'error') throw new CliError(r.message, ExitCode.UsageError);
      const p = loadPrefs(ctx.paths);
      p.language.fallback = r.value;
      savePrefs(ctx.paths, p);
      stdout(`✓ language.fallback = ${r.value}\n`);
    });
  lang
    .command('reset')
    .description('reset language config to defaults (auto / system / en)')
    .action(() => {
      const p = loadPrefs(ctx.paths);
      p.language.output = 'auto';
      p.language.ui = 'system';
      p.language.fallback = 'en';
      savePrefs(ctx.paths, p);
      stdout('✓ language config reset to defaults\n');
    });

  config.addCommand(lang);

  // ─── alias ───
  const alias = new Command('alias').description('manage command aliases');
  alias
    .command('check')
    .description('check alias status')
    .action(() => {
      const shell = detectShell();
      stdout(`shell: ${shell.kind}\n`);
      if (shell.rcFile === null) {
        stdout('(no rc file for this shell)\n');
        return;
      }
      const rtai = detectOccupancy({ name: 'rtai', rcFile: shell.rcFile });
      const rt = detectOccupancy({ name: 'rt', rcFile: shell.rcFile });
      stdout(`rtai: ${rtai.kind}\n`);
      stdout(`rt:   ${rt.kind}\n`);
    });
  alias
    .command('unset-short')
    .description('remove rt short alias')
    .action(() => {
      const shell = detectShell();
      if (shell.rcFile === null) throw new CliError('no rc file for this shell', ExitCode.ConfigError);
      const removed = unsetAliasFromRc({ rcFile: shell.rcFile, kind: 'short' });
      stdout(removed ? '✓ short alias removed\n' : '· no short alias to remove\n');
      const p = loadPrefs(ctx.paths);
      p.cli.short_alias = null;
      p.cli.short_alias_status = 'skipped';
      p.cli.short_alias_written_to = null;
      savePrefs(ctx.paths, p);
    });
  alias
    .command('unset-primary')
    .description('remove primary alias fallback')
    .action(() => {
      const shell = detectShell();
      if (shell.rcFile === null) throw new CliError('no rc file for this shell', ExitCode.ConfigError);
      const removed = unsetAliasFromRc({ rcFile: shell.rcFile, kind: 'primary_fallback' });
      stdout(removed ? '✓ primary alias removed\n' : '· no primary alias to remove\n');
      const p = loadPrefs(ctx.paths);
      p.cli.primary_name = 'rtai';
      p.cli.primary_status = 'native';
      p.cli.primary_written_to = null;
      savePrefs(ctx.paths, p);
    });

  config.addCommand(alias);

  // 安抚 unused stderr
  void stderr;

  return config;
}

// ─── 共享 IO ───

function loadModels(paths: ConfigPaths): ModelsFile {
  if (!existsSync(paths.modelsYaml)) {
    throw new CliError(
      `models.yaml not found: ${paths.modelsYaml}; run \`rtai setup\``,
      ExitCode.ConfigError,
    );
  }
  const text = readFileSync(paths.modelsYaml, 'utf8');
  return ModelsFileSchema.parse(yamlParse(text)) as ModelsFile;
}

function saveModels(paths: ConfigPaths, models: ModelsFile): void {
  writeFileSync(paths.modelsYaml, yamlStringify(models), { encoding: 'utf8', mode: 0o600 });
}

function loadScenes(paths: ConfigPaths): ScenesFile {
  if (!existsSync(paths.scenesYaml)) {
    throw new CliError(`scenes.yaml not found: ${paths.scenesYaml}`, ExitCode.ConfigError);
  }
  const text = readFileSync(paths.scenesYaml, 'utf8');
  return ScenesFileSchema.parse(yamlParse(text)) as ScenesFile;
}

function loadRolesOrDefault(paths: ConfigPaths): RolesFile {
  if (!existsSync(paths.rolesYaml)) {
    // 不报错，由 config CLI 写入新文件即可
    return {
      enhancer: { mode: 'fixed', model: 'claude' },
      executor: { mode: 'fixed', model: 'claude' },
    } as RolesFile;
  }
  const text = readFileSync(paths.rolesYaml, 'utf8');
  return RolesFileSchema.parse(yamlParse(text)) as RolesFile;
}

function saveRoles(paths: ConfigPaths, roles: RolesFile): void {
  writeFileSync(paths.rolesYaml, yamlStringify(roles), { encoding: 'utf8', mode: 0o600 });
}

function loadPrefs(paths: ConfigPaths): PrefsFile {
  if (!existsSync(paths.prefsYaml)) {
    throw new CliError(`prefs.yaml not found: ${paths.prefsYaml}; run \`rtai setup\``, ExitCode.ConfigError);
  }
  const text = readFileSync(paths.prefsYaml, 'utf8');
  return PrefsFileSchema.parse(yamlParse(text));
}

function savePrefs(paths: ConfigPaths, prefs: PrefsFile): void {
  writeFileSync(paths.prefsYaml, yamlStringify(prefs), { encoding: 'utf8', mode: 0o600 });
}
