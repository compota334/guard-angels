import * as fs from 'node:fs';
import { resolve, relative } from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readAngelMd } from '../angels/memory.js';
import { angelMdFile, configFile } from '../paths/layout.js';
import type { AngelEntry } from '../config/schema.js';

/**
 * Mechanical territory enforcement, designed to run as a Claude Code
 * PreToolUse hook on Edit/Write tools: exit 0 allows the edit, exit 2 blocks
 * it with an actionable message on stderr. No LLM is involved; it must be
 * fast and deterministic.
 */

export interface GuardCheckResult {
  allowed: boolean;
  angelId?: string;
  reason: string;
}

export function guardCheckPath(cwd: string, targetPath: string): GuardCheckResult {
  // The angel subprocess (and its children) are exempt: territory
  // enforcement for angels happens post-hoc in execute via snapshot diff.
  const executing = process.env.GUARD_ANGELS_EXECUTING;
  if (executing) {
    return {
      allowed: true,
      reason: `angel subprocess (${executing}) is exempt from the edit hook`,
    };
  }

  // No republic, nothing to guard. The hook can be installed in projects
  // (or subdirectories) without a .angels/; that must not break editing.
  if (!fs.existsSync(configFile(cwd))) {
    return { allowed: true, reason: 'no .angels/_config.yml in this project' };
  }

  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);

  const absTarget = resolve(cwd, targetPath);
  const relTarget = relative(cwd, absTarget);
  if (relTarget === '' || relTarget.startsWith('..')) {
    return { allowed: true, reason: 'path is outside the project root' };
  }

  // Deepest ACTIVE folder angel whose territory contains the path wins.
  // The root angel never blocks: its territory is the whole project, and
  // blocking every edit would make the hook unusable; folder territories
  // are the enforceable ones.
  const owners = registry
    .listAll()
    .filter((angel) => angel.type === 'folder')
    .filter((angel) => containsPath(cwd, angel, absTarget))
    .sort((a, b) => b.path.length - a.path.length);

  for (const angel of owners) {
    if (isActiveAngel(cwd, angel)) {
      return {
        allowed: false,
        angelId: angel.id,
        reason: `"${relTarget}" belongs to the territory of active angel "${angel.id}"`,
      };
    }
  }

  return { allowed: true, reason: 'no active angel owns this path' };
}

function containsPath(cwd: string, angel: AngelEntry, absTarget: string): boolean {
  const rel = relative(resolve(cwd, angel.path), absTarget);
  return rel === '' || !rel.startsWith('..');
}

function isActiveAngel(cwd: string, angel: AngelEntry): boolean {
  try {
    const { frontmatter } = readAngelMd(angelMdFile(cwd, angel.path));
    return frontmatter.status === 'active';
  } catch {
    // Missing or unreadable angel.md: the angel is not operational, so it
    // cannot claim its territory.
    return false;
  }
}

/**
 * CLI entry point. Two modes:
 * - path mode: `angels guard-check <path>`
 * - hook mode: `angels guard-check --hook` reads the Claude Code PreToolUse
 *   JSON payload from stdin and extracts the target file path.
 *
 * Returns the process exit code: 0 allow, 2 block. Throws on usage errors.
 */
export function runGuardCheck(
  cwd: string,
  options: { path?: string; hook?: boolean },
): number {
  let target = options.path;

  if (options.hook) {
    const raw = fs.readFileSync(0, 'utf-8');
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (err: unknown) {
      throw new Error(
        `guard-check --hook received a non-JSON payload on stdin: ${(err as Error).message}`,
        { cause: err },
      );
    }
    const toolInput =
      payload !== null && typeof payload === 'object'
        ? ((payload as Record<string, unknown>).tool_input as Record<string, unknown> | undefined)
        : undefined;
    const filePath = toolInput?.file_path ?? toolInput?.notebook_path;
    if (typeof filePath !== 'string' || filePath === '') {
      // This tool call carries no file path: nothing to guard.
      return 0;
    }
    target = filePath;
  }

  if (!target) {
    throw new Error('guard-check requires a <path> argument (or --hook with a payload on stdin)');
  }

  const result = guardCheckPath(cwd, target);
  if (result.allowed) {
    return 0;
  }

  process.stderr.write(formatBlockMessage(result));
  return 2;
}

function formatBlockMessage(result: GuardCheckResult): string {
  const id = result.angelId ?? 'unknown';
  return (
    `BLOCKED by Guard Angels: ${result.reason}.\n` +
    `Direct edits are forbidden: they bypass review, leave angel.md stale, ` +
    `and break the audit trail.\n` +
    `Delegate instead:\n` +
    `  angels brief ${id} "<describe the change>"\n` +
    `  angels execute ${id} <brief-path>   (after reviewing the response)\n` +
    `Or in one step: angels do ${id} "<task>"\n`
  );
}
