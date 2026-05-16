import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { doAngel } from '../../src/commands/do.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  setupProject,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('doAngel', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-do-'));
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

  it('auto-executes when angel responds proceed and returns 0', async () => {
    // Default fake backend: review → proceed, execute → done
    const inTerritoryFile = join(tmpDir, 'src', 'auth', 'logout.ts');
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_WRITE_FILES: inTerritoryFile,
        FAKE_BACKEND_FILES_CHANGED: 'src/auth/logout.ts',
        FAKE_BACKEND_ANGEL_MD_UPDATED: 'false',
      },
      'do-proceed-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await doAngel(tmpDir, 'src-auth', 'Add a logout endpoint');

    expect(exitCode).toBe(0);
    expect(fs.existsSync(inTerritoryFile)).toBe(true);

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    // Review entry
    expect(newspaper).toContain('DO reviewed. RESPONSE: PROCEED');
    // Execute entry
    expect(newspaper).toContain('EXECUTE completed successfully');
  });

  it('returns 2 and does not execute when angel responds concerns', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'concerns',
        FAKE_BACKEND_CONCERNS: 'This may break session handling',
      },
      'do-concerns-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await doAngel(tmpDir, 'src-auth', 'Refactor session handling');

    expect(exitCode).toBe(2);

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('DO reviewed. RESPONSE: CONCERNS');
    expect(newspaper).not.toContain('EXECUTE');
  });

  it('returns 3 and does not execute when angel responds refuse', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'refuse',
        FAKE_BACKEND_CONCERNS: 'Violates invariants',
      },
      'do-refuse-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await doAngel(tmpDir, 'src-auth', 'Delete session handling');

    expect(exitCode).toBe(3);

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('DO reviewed. RESPONSE: REFUSE');
    expect(newspaper).not.toContain('EXECUTE');
  });

  it('returns 1 when angel errors during review', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'error',
        FAKE_BACKEND_CONCERNS: 'Internal error',
      },
      'do-error-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await doAngel(tmpDir, 'src-auth', 'Test error handling');

    expect(exitCode).toBe(1);

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper).toContain('DO reviewed. RESPONSE: ERROR');
    expect(newspaper).not.toContain('EXECUTE');
  });

  it('throws for non-existent angel id', async () => {
    await expect(
      doAngel(tmpDir, 'nonexistent-angel', 'Some task'),
    ).rejects.toThrow(/nonexistent-angel/);
  });
});
