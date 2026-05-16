import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { briefAngel } from '../../src/commands/brief.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  setupProject,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('briefAngel', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-brief-'));

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

  it('returns exit code 2 for RESPONSE: concerns', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'concerns',
        FAKE_BACKEND_CONCERNS: 'This change may break session management',
      },
      'concerns-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Refactor session handling',
    );

    expect(exitCode).toBe(2);
  });

  it('returns exit code 3 for RESPONSE: refuse', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'refuse',
        FAKE_BACKEND_CONCERNS: 'This fundamentally violates the session invariants',
      },
      'refuse-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Delete all session handling',
    );

    expect(exitCode).toBe(3);
  });

  it('returns exit code 1 for RESPONSE: error', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'error',
        FAKE_BACKEND_CONCERNS: 'Internal error occurred',
      },
      'error-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await briefAngel(
      tmpDir,
      'src-auth',
      'Test error handling',
    );

    expect(exitCode).toBe(1);
  });

  it('throws for non-existent angel id', async () => {
    await expect(
      briefAngel(tmpDir, 'nonexistent-angel', 'Some task'),
    ).rejects.toThrow(/nonexistent-angel/);
  });
});
