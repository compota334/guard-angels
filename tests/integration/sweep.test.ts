import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { sweepAngels } from '../../src/commands/sweep.js';
import { appendNewspaper } from '../../src/messaging/newspaper.js';
import { setCursor } from '../../src/messaging/cursors.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  setupProject,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('sweepAngels', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-sweep-'));

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

  it('sweeps all angels sequentially and returns exit code 0', async () => {
    // Seed a pre-existing newspaper entry so the angels have a non-empty
    // delta to consume. The cursor advances only as far as the snapshot taken
    // before invoke (what the angel was actually shown), so without a seeded
    // entry the cursor would correctly stay at 0.
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T10:00:00Z',
      angelId: 'src-auth',
      summary: 'Seed entry before sweep.',
    });

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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'done',
        FAKE_BACKEND_DRIFT_REPORT: driftReport,
      },
      'sweep-drift-wrapper.sh',
    );
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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'error',
        FAKE_BACKEND_CONCERNS: 'Failed to scan folder',
      },
      'sweep-error-wrapper.sh',
    );
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

  it('does NOT advance the angel cursor when the angel responds with error', async () => {
    // Pre-seed a newspaper entry the angel will be shown as delta and
    // pre-set the cursor to 0 so the entry is in scope.
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T12:00:00Z',
      angelId: '_root',
      summary: 'Pre-existing entry the angel must consume.',
    });
    setCursor(tmpDir, 'src-auth', 0);

    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'error',
        FAKE_BACKEND_CONCERNS: 'Cannot process delta — disk full',
      },
      'sweep-error-cursor-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    await sweepAngels(tmpDir);

    // The src-auth cursor must still be 0 — the angel did not consume the
    // delta successfully, so the next sweep needs to re-present it.
    const authCursor = parseInt(
      fs.readFileSync(join(tmpDir, '.angels', '_cursors', 'src-auth'), 'utf-8').trim(),
      10,
    );
    expect(authCursor).toBe(0);
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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'concerns',
        FAKE_BACKEND_CONCERNS: 'Detected possible API contract change',
        FAKE_BACKEND_DRIFT_REPORT: 'New exports added to index.ts',
      },
      'sweep-concerns-wrapper.sh',
    );
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
