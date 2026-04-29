import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { executeAngel } from '../../src/commands/execute.js';
import { writeBrief } from '../../src/protocol/brief.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  setupProject,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('executeAngel', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-execute-'));

    // Copy consolidated fake-backend.sh to space-free tmpDir
    fakeBackendPath = copyFakeBackend(tmpDir);

    setupProject(tmpDir, { backendScript: fakeBackendPath });
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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'done',
        FAKE_BACKEND_FILES_CHANGED: 'src/auth/logout.ts',
        FAKE_BACKEND_WRITE_FILES: inTerritoryFile,
        FAKE_BACKEND_ANGEL_MD_UPDATED: 'false',
      },
      'execute-done-wrapper.sh',
    );
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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'done',
        FAKE_BACKEND_FILES_CHANGED: 'src/auth/helper.ts, src/utils/shared.ts',
        FAKE_BACKEND_WRITE_FILES: `${inTerritoryFile},${outOfTerritoryFile}`,
        FAKE_BACKEND_ANGEL_MD_UPDATED: 'false',
      },
      'execute-oot-wrapper.sh',
    );
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

    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'error',
        FAKE_BACKEND_CONCERNS: 'Something went wrong during execution',
      },
      'execute-error-wrapper.sh',
    );
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
