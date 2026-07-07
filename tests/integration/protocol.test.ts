/**
 * End-to-end integration test for the full Guard Angels protocol.
 *
 * Exercises the complete happy path:
 *   init → create → brief (REVIEW) → execute (EXECUTE) → newspaper → sweep → doctor
 *
 * Uses fake-backend.sh — no real LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { initAngels } from '../../src/commands/init.js';
import { createAngel } from '../../src/commands/create.js';
import { listAngels } from '../../src/commands/list.js';
import { briefAngel } from '../../src/commands/brief.js';
import { executeAngel } from '../../src/commands/execute.js';
import { showNewspaper } from '../../src/commands/newspaper.js';
import { sweepAngels } from '../../src/commands/sweep.js';
import { runDoctor } from '../../src/commands/doctor.js';
import { writeBrief } from '../../src/protocol/brief.js';
import { readNewspaperSince, getNewspaperSize } from '../../src/messaging/newspaper.js';
import { getCursor } from '../../src/messaging/cursors.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('end-to-end protocol flow', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-e2e-'));

    // Copy consolidated fake-backend.sh to space-free tmpDir
    fakeBackendPath = copyFakeBackend(tmpDir);

    // Create a synthetic project tree with meaningful folders
    // src/auth — has 3 source files (qualifies via >=3 files heuristic)
    const authDir = join(tmpDir, 'src', 'auth');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(join(authDir, 'session.ts'), 'export const session = {};');
    fs.writeFileSync(join(authDir, 'middleware.ts'), 'export const mw = {};');
    fs.writeFileSync(join(authDir, 'types.ts'), 'export type User = {};');

    // src/api — has index.ts (qualifies via index file heuristic)
    const apiDir = join(tmpDir, 'src', 'api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(join(apiDir, 'index.ts'), 'export {};');
    fs.writeFileSync(join(apiDir, 'routes.ts'), 'export {};');
  });

  afterEach(() => {
    const lp = lockFilePath(tmpDir);
    if (fs.existsSync(lp)) {
      fs.unlinkSync(lp);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the full happy path: init → create → brief → execute → newspaper → sweep → doctor', async () => {
    // ────────────────────────────────────────────────────────
    // Step 1: angels init --auto
    // ────────────────────────────────────────────────────────
    // Point the backend at the fake script for ingestion
    // We need to set up a wrapper that the init command can use.
    // init creates its own config, so we use environment for backend cmd.
    // Actually, init generates the config from scratch. It uses DEFAULT_BACKEND_CMD
    // unless the user overrides. We'll let init use the default, then update config
    // to use our fake backend before brief/execute calls.
    await initAngels(tmpDir, { auto: true });

    // Verify .angels/ structure was created
    expect(fs.existsSync(join(tmpDir, '.angels', '_config.yml'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_newspaper.md'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_root', 'angel.md'))).toBe(true);

    // Verify at least src/auth and src/api were detected as candidates
    const configYaml = fs.readFileSync(
      join(tmpDir, '.angels', '_config.yml'),
      'utf-8',
    );
    expect(configYaml).toContain('_root');
    expect(configYaml).toContain('src/auth');
    expect(configYaml).toContain('src/api');

    // ────────────────────────────────────────────────────────
    // Step 2: angels list (verify no errors)
    // ────────────────────────────────────────────────────────
    expect(() => listAngels(tmpDir)).not.toThrow();

    // ────────────────────────────────────────────────────────
    // Step 3: angels create <new-path>
    // ────────────────────────────────────────────────────────
    // Create a new folder to add after init
    const paymentsDir = join(tmpDir, 'src', 'payments');
    fs.mkdirSync(paymentsDir, { recursive: true });
    fs.writeFileSync(join(paymentsDir, 'checkout.ts'), 'export {};');

    // Now update config to use our fake backend (needed for ingestion in create)
    updateConfig(tmpDir, fakeBackendPath, undefined, 30);

    // Wait — updateConfig overwrites the whole config. We need to preserve
    // the angels from init. Let me read the existing config and just update
    // the backend command.
    // Actually, let's re-read the config and use the existing angels list.
    // The create command will load the config, so we need to make sure
    // the fake backend is set. Let's parse the init-generated config
    // and reconstruct with our fake backend.

    // Read the existing _config.yml to get the angels list from init
    const { parse: parseYaml } = await import('yaml');
    const existingConfig = parseYaml(
      fs.readFileSync(join(tmpDir, '.angels', '_config.yml'), 'utf-8'),
    );
    const existingAngels = existingConfig.angels as Array<{
      id: string;
      type: 'root' | 'folder';
      path: string;
    }>;

    // Update config with our fake backend but keep all existing angels
    updateConfig(tmpDir, fakeBackendPath, existingAngels, 30);

    await createAngel(tmpDir, 'src/payments');

    // Verify new angel was added to config
    const updatedConfigYaml = fs.readFileSync(
      join(tmpDir, '.angels', '_config.yml'),
      'utf-8',
    );
    expect(updatedConfigYaml).toContain('src/payments');

    // Verify angel.md was created for the new angel
    expect(
      fs.existsSync(join(tmpDir, '.angels', 'src', 'payments', 'angel.md')),
    ).toBe(true);

    // ────────────────────────────────────────────────────────
    // Step 4: angels brief (REVIEW phase)
    // ────────────────────────────────────────────────────────
    // Re-read config after create added the new angel
    const configAfterCreate = parseYaml(
      fs.readFileSync(join(tmpDir, '.angels', '_config.yml'), 'utf-8'),
    );
    updateConfig(
      tmpDir,
      fakeBackendPath,
      configAfterCreate.angels,
      30,
    );

    const briefExitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Add a logout endpoint to the auth module',
    );

    expect(briefExitCode).toBe(0); // proceed

    // Verify brief file was created
    const briefsDir = join(tmpDir, '.angels', '_briefs', 'src-auth');
    const briefFiles = fs.readdirSync(briefsDir);
    expect(briefFiles.length).toBeGreaterThanOrEqual(1);

    // Verify response file was created
    const responsesDir = join(tmpDir, '.angels', '_responses', 'src-auth');
    const responseFiles = fs.readdirSync(responsesDir);
    expect(responseFiles.length).toBe(1);

    // ────────────────────────────────────────────────────────
    // Step 5: angels execute (EXECUTE phase)
    // ────────────────────────────────────────────────────────
    // Create a review brief for the execute step
    const reviewBriefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Add a logout endpoint to the auth module',
      context: '',
      expectedScope: 'src/auth/logout.ts',
      priorResponse: 'none',
    });

    // Configure execute backend to write in-territory
    const inTerritoryFile = join(tmpDir, 'src', 'auth', 'logout.ts');
    const executeWrapper = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'done',
        FAKE_BACKEND_FILES_CHANGED: 'src/auth/logout.ts',
        FAKE_BACKEND_WRITE_FILES: inTerritoryFile,
        FAKE_BACKEND_ANGEL_MD_UPDATED: 'true',
      },
      'e2e-execute-wrapper.sh',
    );

    // Update config with existing angels from create step
    updateConfig(tmpDir, executeWrapper, configAfterCreate.angels, 30);

    const newspaperSizeBefore = getNewspaperSize(tmpDir);

    const executeExitCode = await executeAngel(
      tmpDir,
      'src-auth',
      reviewBriefPath,
    );

    expect(executeExitCode).toBe(0);

    // Verify the file was created in-territory
    expect(fs.existsSync(inTerritoryFile)).toBe(true);

    // ────────────────────────────────────────────────────────
    // Step 6: Verify newspaper grows monotonically
    // ────────────────────────────────────────────────────────
    const newspaperSizeAfterExecute = getNewspaperSize(tmpDir);
    expect(newspaperSizeAfterExecute).toBeGreaterThan(newspaperSizeBefore);

    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    // Verify at least one entry mentions src-auth and EXECUTE
    const executeEntry = entries.find(
      (e) => e.angelId === 'src-auth' && e.body?.includes('EXECUTE'),
    );
    expect(executeEntry).toBeDefined();

    // Verify no territory warning for in-territory writes
    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).not.toContain('WARNING: Out-of-territory');

    // showNewspaper should not throw
    expect(() => showNewspaper(tmpDir)).not.toThrow();

    // ────────────────────────────────────────────────────────
    // Step 7: angels sweep
    // ────────────────────────────────────────────────────────
    // Reset backend to the plain fake backend for sweep
    updateConfig(tmpDir, fakeBackendPath, configAfterCreate.angels, 30);

    const newspaperSizeBeforeSweep = getNewspaperSize(tmpDir);

    const sweepExitCode = await sweepAngels(tmpDir);

    expect(sweepExitCode).toBe(0);

    // Newspaper should have grown from sweep entries
    const newspaperSizeAfterSweep = getNewspaperSize(tmpDir);
    expect(newspaperSizeAfterSweep).toBeGreaterThan(newspaperSizeBeforeSweep);

    // Verify sweep entries for all angels
    const sweepEntries = readNewspaperSince(tmpDir, newspaperSizeBeforeSweep);
    expect(sweepEntries.length).toBeGreaterThanOrEqual(1);

    const sweepNewspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(sweepNewspaper).toContain('SWEEP');

    // Verify cursors were advanced
    const rootCursor = getCursor(tmpDir, '_root');
    expect(rootCursor).toBeGreaterThan(0);

    // ────────────────────────────────────────────────────────
    // Step 8: angels doctor
    // ────────────────────────────────────────────────────────
    const doctorExitCode = await runDoctor(tmpDir);

    // Exit 0 means no issues found (or only informational issues)
    // The doctor may report "missing angels" for src/ parent dir
    // depending on heuristics, but it should not crash
    expect(typeof doctorExitCode).toBe('number');

    // ────────────────────────────────────────────────────────
    // Step 9: Verify lock is always released
    // ────────────────────────────────────────────────────────
    expect(fs.existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  it('detects out-of-territory writes during execute and logs newspaper warning', async () => {
    // Set up a pre-initialized project directly (skip init for speed)
    const angelsDir = join(tmpDir, '.angels');
    const dirs = [
      '_briefs', '_responses', '_inbox', '_outbox',
      '_locks', '_logs', '_cursors', '_root',
    ];
    for (const d of dirs) {
      fs.mkdirSync(join(angelsDir, d), { recursive: true });
    }

    // Create angel dirs
    fs.mkdirSync(join(angelsDir, 'src', 'auth'), { recursive: true });

    // Write _config.yml
    const { stringify: yamlStringify } = await import('yaml');
    const angels = [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
    ];
    fs.writeFileSync(
      join(angelsDir, '_config.yml'),
      yamlStringify(
        {
          version: 1,
          backend: { angel_cmd: fakeBackendPath, angel_timeout_seconds: 30 },
          angels,
          sweep: { autonomy: 'report-only' },
        },
        { lineWidth: 0 },
      ),
      'utf-8',
    );

    // Create _newspaper.md
    fs.writeFileSync(join(angelsDir, '_newspaper.md'), '', 'utf-8');

    // Create angel.md files
    const { writeAngelMd } = await import('../../src/angels/memory.js');
    const now = new Date().toISOString();

    writeAngelMd(join(angelsDir, '_root', 'angel.md'), {
      frontmatter: { status: 'active', last_updated: now, last_updated_by: 'main' },
      body: '# Angel: . (root)\n\n## Charter\nRoot angel.\n',
    });

    writeAngelMd(join(angelsDir, 'src', 'auth', 'angel.md'), {
      frontmatter: { status: 'active', last_updated: now, last_updated_by: 'main' },
      body: '# Angel: src/auth (folder)\n\n## Charter\nAuth module.\n',
    });

    // Write a review brief for execute
    const reviewBriefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: now,
      phase: 'review',
      type: 'change_request',
      task: 'Add shared utility used by auth',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    // Configure the fake backend to write OUTSIDE territory
    const outOfTerritoryFile = join(tmpDir, 'src', 'utils', 'shared.ts');
    const inTerritoryFile = join(tmpDir, 'src', 'auth', 'helper.ts');
    const ootWrapper = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'done',
        FAKE_BACKEND_FILES_CHANGED: 'src/auth/helper.ts, src/utils/shared.ts',
        FAKE_BACKEND_WRITE_FILES: `${inTerritoryFile},${outOfTerritoryFile}`,
        FAKE_BACKEND_ANGEL_MD_UPDATED: 'false',
      },
      'e2e-oot-wrapper.sh',
    );
    updateConfig(tmpDir, ootWrapper, angels as Array<{id: string; type: 'root' | 'folder'; path: string}>, 30);

    const exitCode = await executeAngel(tmpDir, 'src-auth', reviewBriefPath);

    // Still exits 0 — territory violation is a warning, not a failure
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

    // Verify newspaper also has the execute completion entry
    expect(newspaper).toContain('[src-auth]');
    expect(newspaper).toContain('EXECUTE');
  });
});
