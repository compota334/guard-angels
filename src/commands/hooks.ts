import * as fs from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Manage the Claude Code PreToolUse hook that enforces territories
 * mechanically. The hook lives in the project's `.claude/settings.json`
 * (shared, committed) and calls `angels guard-check --hook`, which exits 2
 * to block edits inside an active angel's territory.
 */

const GUARD_HOOK_COMMAND = 'angels guard-check --hook';
const GUARD_HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

interface HookCommand {
  type: string;
  command: string;
  [key: string]: unknown;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookMatcherEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function settingsFilePath(cwd: string): string {
  return join(cwd, '.claude', 'settings.json');
}

function readSettings(path: string): ClaudeSettings {
  if (!fs.existsSync(path)) {
    return {};
  }
  const raw = fs.readFileSync(path, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings root is not a JSON object');
    }
    return parsed as ClaudeSettings;
  } catch (err: unknown) {
    throw new Error(
      `Cannot parse ${path}: ${(err as Error).message}. Fix the file manually before installing hooks.`,
      { cause: err },
    );
  }
}

function writeSettings(path: string, settings: ClaudeSettings): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function isGuardEntry(entry: HookMatcherEntry): boolean {
  return (entry.hooks ?? []).some((h) => h.command?.includes('angels guard-check'));
}

export function isHookInstalled(cwd: string): boolean {
  const path = settingsFilePath(cwd);
  if (!fs.existsSync(path)) return false;
  const settings = readSettings(path);
  return (settings.hooks?.PreToolUse ?? []).some(isGuardEntry);
}

/**
 * Install the guard hook into .claude/settings.json (idempotent).
 * Returns exit code 0.
 */
export function installHooks(cwd: string): number {
  const path = settingsFilePath(cwd);
  const settings = readSettings(path);

  const preToolUse = settings.hooks?.PreToolUse ?? [];
  if (preToolUse.some(isGuardEntry)) {
    console.log(`Guard hook already installed in ${path}. Nothing to do.`);
    return 0;
  }

  preToolUse.push({
    matcher: GUARD_HOOK_MATCHER,
    hooks: [{ type: 'command', command: GUARD_HOOK_COMMAND }],
  });
  settings.hooks = { ...(settings.hooks ?? {}), PreToolUse: preToolUse };
  writeSettings(path, settings);

  console.log(`Guard hook installed in ${path}.`);
  console.log('');
  console.log('From now on, Edit/Write tool calls inside an active angel\'s territory');
  console.log('are blocked mechanically (exit 2) and redirected to "angels brief".');
  console.log('Requires the "angels" binary on PATH (npm install -g @guard-angels/cli).');
  console.log('Restart any running Claude Code session for the hook to take effect.');
  return 0;
}

/**
 * Remove the guard hook from .claude/settings.json (idempotent).
 * Returns exit code 0.
 */
export function uninstallHooks(cwd: string): number {
  const path = settingsFilePath(cwd);
  if (!fs.existsSync(path)) {
    console.log(`No ${path} found. Nothing to uninstall.`);
    return 0;
  }

  const settings = readSettings(path);
  const preToolUse = settings.hooks?.PreToolUse ?? [];
  const remaining = preToolUse.filter((entry) => !isGuardEntry(entry));

  if (remaining.length === preToolUse.length) {
    console.log(`Guard hook not present in ${path}. Nothing to do.`);
    return 0;
  }

  if (remaining.length > 0) {
    settings.hooks = { ...(settings.hooks ?? {}), PreToolUse: remaining };
  } else if (settings.hooks) {
    delete settings.hooks.PreToolUse;
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }
  writeSettings(path, settings);

  console.log(`Guard hook removed from ${path}.`);
  return 0;
}

/**
 * Report whether the guard hook is installed. Returns exit code 0 when
 * installed, 1 when not (scriptable).
 */
export function hooksStatus(cwd: string): number {
  const path = settingsFilePath(cwd);
  if (isHookInstalled(cwd)) {
    console.log(`Guard hook: INSTALLED (${path})`);
    console.log(`  matcher: ${GUARD_HOOK_MATCHER}`);
    console.log(`  command: ${GUARD_HOOK_COMMAND}`);
    return 0;
  }
  console.log(`Guard hook: NOT INSTALLED (checked ${path})`);
  console.log('Install with: angels hooks install');
  return 1;
}
