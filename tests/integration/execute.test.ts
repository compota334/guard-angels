import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { executeAngel } from '../../src/commands/execute.js';
import { writeBrief } from '../../src/protocol/brief.js';
import { writeAngelMd } from '../../src/angels/memory.js';
import { lockFilePath } from '../../src/locks/lock.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

describe('executeAngel', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-execute-'));

    // Copy fake-execute-backend.sh to space-free tmpDir
    fakeBackendPath = join(tmpDir, 'fake-execute-backend.sh');
    fs.copyFileSync(
      resolve(FIXTURES_DIR, 'fake-execute-backend.sh'),
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

  it('returns exit code 0 for clean in-territory execute', async () => {
    // Create a review brief first (simulating the phase 1 output)
    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Add a logout endpoint',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    // Configure the fake backend to write a file in-territory
    const inTerritoryFile = join(tmpDir, 'src', 'auth', 'logout.ts');
    const wrapperPath = createExecuteWrapper(tmpDir, fakeBackendPath, {
      verdict: 'done',
      filesChanged: 'src/auth/logout.ts',
      writeFiles: inTerritoryFile,
      angelMdUpdated: 'false',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);

    expect(exitCode).toBe(0);

    // Verify the file was created in-territory
    expect(fs.existsSync(inTerritoryFile)).toBe(true);

    // Verify newspaper entry was appended
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('[src-auth]');
    expect(newspaper).toContain('EXECUTE completed successfully');
    expect(newspaper).not.toContain('WARNING');

    // Verify lock was released
    expect(fs.existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  it('detects out-of-territory writes and logs warning to newspaper', async () => {
    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Add shared utility',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    // Configure the fake backend to write a file OUTSIDE territory
    const outOfTerritoryFile = join(tmpDir, 'src', 'utils', 'shared.ts');
    const inTerritoryFile = join(tmpDir, 'src', 'auth', 'helper.ts');
    const wrapperPath = createExecuteWrapper(tmpDir, fakeBackendPath, {
      verdict: 'done',
      filesChanged: 'src/auth/helper.ts, src/utils/shared.ts',
      writeFiles: `${inTerritoryFile},${outOfTerritoryFile}`,
      angelMdUpdated: 'false',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);

    // Still exits 0 (done) — territory violation is a warning, not a failure
    expect(exitCode).toBe(0);

    // Verify both files were created
    expect(fs.existsSync(outOfTerritoryFile)).toBe(true);
    expect(fs.existsSync(inTerritoryFile)).toBe(true);

    // Verify newspaper has the territory warning
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('WARNING: Out-of-territory writes detected');
    expect(newspaper).toContain('src/utils/shared.ts');
  });

  it('returns exit code 1 for RESPONSE: error from fake backend', async () => {
    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Trigger error response',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    const wrapperPath = createExecuteWrapper(tmpDir, fakeBackendPath, {
      verdict: 'error',
      concerns: 'Something went wrong during execution',
    });
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);

    expect(exitCode).toBe(1);

    // Verify newspaper still has an entry (appended on every execute)
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('[src-auth]');
    expect(newspaper).toContain('EXECUTE finished with RESPONSE: error');
  });

  it('throws for non-existent angel id', async () => {
    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Some task',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    await expect(
      executeAngel(tmpDir, 'nonexistent-angel', briefPath),
    ).rejects.toThrow(/nonexistent-angel/);
  });
});

/**
 * Create a wrapper script that sets environment variables
 * for the fake execute backend.
 */
function createExecuteWrapper(
  dir: string,
  backendPath: string,
  opts: {
    verdict: string;
    concerns?: string;
    filesChanged?: string;
    writeFiles?: string;
    angelMdUpdated?: string;
    cablesSent?: string;
  },
): string {
  const name = `execute-${opts.verdict}-wrapper.sh`;
  const wrapperPath = join(dir, name);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `export FAKE_BACKEND_VERDICT="${opts.verdict}"`,
  ];
  if (opts.concerns) {
    lines.push(`export FAKE_BACKEND_CONCERNS="${opts.concerns}"`);
  }
  if (opts.filesChanged) {
    lines.push(`export FAKE_BACKEND_FILES_CHANGED="${opts.filesChanged}"`);
  }
  if (opts.writeFiles) {
    lines.push(`export FAKE_BACKEND_WRITE_FILES="${opts.writeFiles}"`);
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
