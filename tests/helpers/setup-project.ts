/**
 * Shared test helpers for setting up synthetic Guard Angels projects.
 *
 * Consolidates the duplicated setupProject / updateConfig / createWrapper
 * functions that were previously inlined in each integration test file.
 */

import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { writeAngelMd } from '../../src/angels/memory.js';

/** Path to the consolidated fake-backend.sh fixture. */
export const FAKE_BACKEND_SRC = resolve(
  import.meta.dirname,
  '../fixtures/fake-backend.sh',
);

/** Path to the legacy echo-backend.sh fixture. */
export const ECHO_BACKEND_SRC = resolve(
  import.meta.dirname,
  '../fixtures/echo-backend.sh',
);

/**
 * Copy the consolidated fake-backend.sh to a space-free temp directory
 * and return the destination path. Necessary because execa's
 * parseCommandString splits on spaces and the project path contains one.
 */
export function copyFakeBackend(tmpDir: string): string {
  const dest = join(tmpDir, 'fake-backend.sh');
  fs.copyFileSync(FAKE_BACKEND_SRC, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}

/**
 * Copy the legacy echo-backend.sh to a space-free temp directory.
 */
export function copyEchoBackend(tmpDir: string): string {
  const dest = join(tmpDir, 'echo-backend.sh');
  fs.copyFileSync(ECHO_BACKEND_SRC, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}

/**
 * Angel entry for config generation.
 */
interface AngelEntry {
  id: string;
  type: 'root' | 'folder';
  path: string;
  /** Proof-of-done checks run by execute after a done verdict. */
  checks?: { name: string; cmd: string }[];
}

/**
 * Options for setupProject.
 */
interface SetupProjectOptions {
  /** Path to the backend script to use in _config.yml. */
  backendScript: string;
  /** Angels to register. Defaults to _root + src-auth. */
  angels?: AngelEntry[];
  /** Timeout in seconds. Defaults to 30. */
  timeoutSeconds?: number;
}

/**
 * Standard two-angel config: _root + src-auth.
 */
export const DEFAULT_ANGELS: AngelEntry[] = [
  { id: '_root', type: 'root', path: '.' },
  { id: 'src-auth', type: 'folder', path: 'src/auth' },
];

/**
 * Set up a synthetic project with full .angels/ directory structure,
 * _config.yml, _newspaper.md, and angel.md files.
 *
 * Creates source directories matching the registered angels
 * (src/auth with a session.ts file).
 */
export function setupProject(
  projectRoot: string,
  opts: SetupProjectOptions,
): void {
  const angels = opts.angels ?? DEFAULT_ANGELS;
  const timeoutSeconds = opts.timeoutSeconds ?? 30;

  // Create source directories for folder-type angels
  for (const angel of angels) {
    if (angel.type === 'folder') {
      const dir = join(projectRoot, angel.path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(join(dir, 'session.ts'), 'export {};');
    }
  }

  // Create .angels/ structure
  const angelsDir = join(projectRoot, '.angels');
  const dirs = [
    '_briefs', '_responses', '_inbox', '_outbox',
    '_locks', '_logs', '_cursors',
  ];
  for (const d of dirs) {
    fs.mkdirSync(join(angelsDir, d), { recursive: true });
  }

  // Write _config.yml
  writeConfig(projectRoot, `bash ${opts.backendScript}`, angels, timeoutSeconds);

  // Create _newspaper.md
  fs.writeFileSync(join(angelsDir, '_newspaper.md'), '', 'utf-8');

  // Create angel.md for each registered angel
  for (const angel of angels) {
    const angelSubdir = angel.type === 'root' ? '_root' : angel.path;
    const angelDir = join(angelsDir, angelSubdir);
    fs.mkdirSync(angelDir, { recursive: true });

    const title = angel.type === 'root'
      ? '# Angel: . (root)\n\n## Charter\nRoot angel for the project.\n'
      : `# Angel: ${angel.path} (folder)\n\n## Charter\nHandles ${angel.id.replace(/-/g, ' ')}.\n`;

    writeAngelMd(join(angelDir, 'angel.md'), {
      frontmatter: {
        status: 'active',
        last_updated: '2026-04-28T10:00:00Z',
        last_updated_by: 'main',
      },
      body: title,
    });
  }
}

/**
 * Write (or overwrite) _config.yml with the given backend command.
 */
export function updateConfig(
  projectRoot: string,
  backendScript: string,
  angels?: AngelEntry[],
  timeoutSeconds?: number,
): void {
  writeConfig(projectRoot, `bash ${backendScript}`, angels ?? DEFAULT_ANGELS, timeoutSeconds ?? 30);
}

function writeConfig(
  projectRoot: string,
  angelCmd: string,
  angels: AngelEntry[],
  timeoutSeconds: number,
): void {
  const config = {
    version: 1,
    backend: {
      angel_cmd: angelCmd,
      angel_timeout_seconds: timeoutSeconds,
    },
    angels,
    sweep: {
      autonomy: 'report-only',
    },
  };
  fs.writeFileSync(
    join(projectRoot, '.angels', '_config.yml'),
    yamlStringify(config, { lineWidth: 0 }),
    'utf-8',
  );
}

/**
 * Create a wrapper script that sets environment variables and delegates
 * to the consolidated fake-backend.sh. Returns the wrapper path.
 *
 * This replaces the per-test createVerdictWrapper / createExecuteWrapper /
 * createSweepWrapper functions with a single generic helper.
 */
export function createBackendWrapper(
  dir: string,
  backendPath: string,
  envVars: Record<string, string>,
  name?: string,
): string {
  const wrapperName = name ?? `wrapper-${Date.now()}.sh`;
  const wrapperPath = join(dir, wrapperName);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
  ];
  for (const [key, value] of Object.entries(envVars)) {
    lines.push(`export ${key}="${value}"`);
  }
  lines.push(`exec bash ${backendPath} "$@"`);
  lines.push('');
  fs.writeFileSync(wrapperPath, lines.join('\n'), { mode: 0o755 });
  return wrapperPath;
}
