import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { briefAngel } from '../../src/commands/brief.js';
import { writeAngelMd } from '../../src/angels/memory.js';
import { lockFilePath } from '../../src/locks/lock.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

describe('briefAngel', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-brief-'));

    // Copy fake-review-backend.sh to space-free tmpDir
    fakeBackendPath = join(tmpDir, 'fake-review-backend.sh');
    fs.copyFileSync(
      resolve(FIXTURES_DIR, 'fake-review-backend.sh'),
      fakeBackendPath,
    );
    fs.chmodSync(fakeBackendPath, 0o755);

    setupProject(tmpDir, fakeBackendPath);
  });

  afterEach(() => {
    const lp = lockFilePath(tmpDir);
    if (fs.existsSync(lp)) {
      fs.unlinkSync(lp);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns exit code 0 for RESPONSE: proceed', async () => {
    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Add a logout endpoint',
    );

    expect(exitCode).toBe(0);

    // Verify brief file was created
    const briefsDir = join(tmpDir, '.angels', '_briefs', 'src-auth');
    const briefs = fs.readdirSync(briefsDir);
    expect(briefs.length).toBe(1);
    expect(briefs[0]).toMatch(/\.md$/);

    // Verify response file was created
    const responsesDir = join(tmpDir, '.angels', '_responses', 'src-auth');
    const responses = fs.readdirSync(responsesDir);
    expect(responses.length).toBe(1);

    // Verify lock was released
    expect(fs.existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  it('returns exit code 1 for RESPONSE: concerns', async () => {
    const wrapperPath = createVerdictWrapper(tmpDir, fakeBackendPath, {
      verdict: 'concerns',
      concerns: 'This change may break session management',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Refactor session handling',
    );

    expect(exitCode).toBe(1);
  });

  it('returns exit code 2 for RESPONSE: refuse', async () => {
    const wrapperPath = createVerdictWrapper(tmpDir, fakeBackendPath, {
      verdict: 'refuse',
      concerns: 'This fundamentally violates the session invariants',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Delete all session handling',
    );

    expect(exitCode).toBe(2);
  });

  it('returns exit code 3 for RESPONSE: error', async () => {
    const wrapperPath = createVerdictWrapper(tmpDir, fakeBackendPath, {
      verdict: 'error',
      concerns: 'Internal error occurred',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Test error handling',
    );

    expect(exitCode).toBe(3);
  });

  it('throws for non-existent angel id', async () => {
    await expect(
      briefAngel(tmpDir, 'nonexistent-angel', 'Some task'),
    ).rejects.toThrow(/nonexistent-angel/);
  });
});

/**
 * Create a wrapper script that sets environment variables
 * for the fake backend to produce a specific verdict.
 */
function createVerdictWrapper(
  dir: string,
  backendPath: string,
  opts: { verdict: string; concerns?: string },
): string {
  const name = `${opts.verdict}-wrapper.sh`;
  const wrapperPath = join(dir, name);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `export FAKE_BACKEND_VERDICT="${opts.verdict}"`,
  ];
  if (opts.concerns) {
    lines.push(`export FAKE_BACKEND_CONCERNS="${opts.concerns}"`);
  }
  lines.push(`exec ${backendPath} "$@"`);
  lines.push('');
  fs.writeFileSync(wrapperPath, lines.join('\n'), { mode: 0o755 });
  return wrapperPath;
}

/**
 * Set up a synthetic project with .angels/ structure, config, and angel.md.
 */
function setupProject(projectRoot: string, backendScript: string): void {
  // Create source directories
  const authDir = join(projectRoot, 'src', 'auth');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(join(authDir, 'session.ts'), 'export {};');

  // Create .angels/ structure
  const angelsDir = join(projectRoot, '.angels');
  fs.mkdirSync(join(angelsDir, '_briefs'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_responses'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_inbox'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_outbox'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_locks'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_logs'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_cursors'), { recursive: true });

  // Write _config.yml
  const config = {
    version: 1,
    backend: {
      angel_cmd: backendScript,
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
    ],
    sweep: {
      autonomy: 'report-only',
    },
  };
  fs.writeFileSync(
    join(angelsDir, '_config.yml'),
    yamlStringify(config, { lineWidth: 0 }),
    'utf-8',
  );

  // Create _newspaper.md
  fs.writeFileSync(join(angelsDir, '_newspaper.md'), '', 'utf-8');

  // Create angel.md for src-auth
  const srcAuthAngelDir = join(angelsDir, 'src', 'auth');
  fs.mkdirSync(srcAuthAngelDir, { recursive: true });
  writeAngelMd(join(srcAuthAngelDir, 'angel.md'), {
    frontmatter: {
      status: 'active',
      last_updated: '2026-04-28T10:00:00Z',
      last_updated_by: 'main',
    },
    body: '# Angel: src/auth (folder)\n\n## Charter\nHandles authentication and session management.\n',
  });

  // Create angel.md for _root
  const rootAngelDir = join(angelsDir, '_root');
  fs.mkdirSync(rootAngelDir, { recursive: true });
  writeAngelMd(join(rootAngelDir, 'angel.md'), {
    frontmatter: {
      status: 'active',
      last_updated: '2026-04-28T10:00:00Z',
      last_updated_by: 'main',
    },
    body: '# Angel: . (root)\n\n## Charter\nRoot angel for the project.\n',
  });
}

/**
 * Update the _config.yml with a new angel_cmd.
 */
function updateConfig(projectRoot: string, angelCmd: string): void {
  const configPath = join(projectRoot, '.angels', '_config.yml');
  const config = {
    version: 1,
    backend: {
      angel_cmd: angelCmd,
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
    ],
    sweep: {
      autonomy: 'report-only',
    },
  };
  fs.writeFileSync(
    configPath,
    yamlStringify(config, { lineWidth: 0 }),
    'utf-8',
  );
}
