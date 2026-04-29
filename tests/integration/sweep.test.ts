import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { sweepAngels } from '../../src/commands/sweep.js';
import { writeAngelMd } from '../../src/angels/memory.js';
import { appendNewspaper } from '../../src/messaging/newspaper.js';
import { setCursor } from '../../src/messaging/cursors.js';
import { lockFilePath } from '../../src/locks/lock.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

describe('sweepAngels', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-sweep-'));

    // Copy fake-sweep-backend.sh to space-free tmpDir
    fakeBackendPath = join(tmpDir, 'fake-sweep-backend.sh');
    fs.copyFileSync(
      resolve(FIXTURES_DIR, 'fake-sweep-backend.sh'),
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

  it('sweeps all angels sequentially and returns exit code 0', async () => {
    const exitCode = await sweepAngels(tmpDir);

    expect(exitCode).toBe(0);

    // Verify newspaper has entries for both angels
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('[_root]');
    expect(newspaper).toContain('[src-auth]');
    expect(newspaper).toContain('SWEEP completed');

    // Verify cursors were advanced for both angels
    const rootCursor = fs.readFileSync(
      join(tmpDir, '.angels', '_cursors', '_root'),
      'utf-8',
    ).trim();
    expect(parseInt(rootCursor, 10)).toBeGreaterThan(0);

    const authCursor = fs.readFileSync(
      join(tmpDir, '.angels', '_cursors', 'src-auth'),
      'utf-8',
    ).trim();
    expect(parseInt(authCursor, 10)).toBeGreaterThan(0);

    // Verify lock was released
    expect(fs.existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  it('includes drift report in newspaper entry', async () => {
    const driftReport = 'Package.json has a new dependency not tracked in angel.md';
    const wrapperPath = createSweepWrapper(tmpDir, fakeBackendPath, {
      verdict: 'done',
      driftReport,
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await sweepAngels(tmpDir);

    expect(exitCode).toBe(0);

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain(driftReport);
  });

  it('returns exit code 1 when an angel responds with error', async () => {
    const wrapperPath = createSweepWrapper(tmpDir, fakeBackendPath, {
      verdict: 'error',
      concerns: 'Failed to scan folder',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await sweepAngels(tmpDir);

    expect(exitCode).toBe(1);

    // Newspaper should still have entries (appended on every sweep)
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('SWEEP finished with RESPONSE: error');
  });

  it('passes --since filter to scope newspaper delta', async () => {
    // Add a pre-existing newspaper entry with a known timestamp
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-01T00:00:00Z',
      angelId: '_root',
      summary: 'Old event before filter.',
    });

    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T12:00:00Z',
      angelId: 'src-auth',
      summary: 'Recent event after filter.',
    });

    // Set cursors to 0 so both entries are in the delta
    setCursor(tmpDir, '_root', 0);
    setCursor(tmpDir, 'src-auth', 0);

    const exitCode = await sweepAngels(tmpDir, { since: '2026-04-28T00:00:00Z' });

    expect(exitCode).toBe(0);

    // Verify sweep completed for both angels (newspaper will have sweep entries)
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('[_root]');
    expect(newspaper).toContain('[src-auth]');
  });

  it('handles sweep with concerns verdict', async () => {
    const wrapperPath = createSweepWrapper(tmpDir, fakeBackendPath, {
      verdict: 'concerns',
      concerns: 'Detected possible API contract change',
      driftReport: 'New exports added to index.ts',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await sweepAngels(tmpDir);

    // concerns is not an error — should still exit 0
    expect(exitCode).toBe(0);

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('SWEEP raised concerns');
  });
});

/**
 * Create a wrapper script that sets environment variables
 * for the fake sweep backend.
 */
function createSweepWrapper(
  dir: string,
  backendPath: string,
  opts: {
    verdict: string;
    concerns?: string;
    driftReport?: string;
    angelMdUpdated?: string;
    cablesSent?: string;
  },
): string {
  const name = `sweep-${opts.verdict}-wrapper.sh`;
  const wrapperPath = join(dir, name);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `export FAKE_BACKEND_VERDICT="${opts.verdict}"`,
  ];
  if (opts.concerns) {
    lines.push(`export FAKE_BACKEND_CONCERNS="${opts.concerns}"`);
  }
  if (opts.driftReport) {
    lines.push(`export FAKE_BACKEND_DRIFT_REPORT="${opts.driftReport}"`);
  }
  if (opts.angelMdUpdated) {
    lines.push(`export FAKE_BACKEND_ANGEL_MD_UPDATED="${opts.angelMdUpdated}"`);
  }
  if (opts.cablesSent) {
    lines.push(`export FAKE_BACKEND_CABLES_SENT="${opts.cablesSent}"`);
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
