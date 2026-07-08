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

describe('executeAngel proof-of-done checks', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-checks-'));
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

  function writeReviewBrief(): string {
    return writeBrief(tmpDir, {
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
  }

  function angelsWithChecks(checks: { name: string; cmd: string }[]) {
    return [
      { id: '_root', type: 'root' as const, path: '.' },
      { id: 'src-auth', type: 'folder' as const, path: 'src/auth', checks },
    ];
  }

  function checksLogFiles(): string[] {
    const dir = join(tmpDir, '.angels', '_logs', 'src-auth');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('-checks.log'));
  }

  it('passes when all checks exit 0 and records evidence', async () => {
    const briefPath = writeReviewBrief();
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'done',
        FAKE_BACKEND_FILES_CHANGED: 'src/auth/logout.ts',
      },
      'checks-pass-wrapper.sh',
    );
    updateConfig(
      tmpDir,
      wrapperPath,
      angelsWithChecks([
        { name: 'always-ok', cmd: 'true' },
        { name: 'echo-check', cmd: 'echo checks ran fine' },
      ]),
    );

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);
    expect(exitCode).toBe(0);

    const newspaper = fs.readFileSync(join(tmpDir, '.angels', '_newspaper.md'), 'utf-8');
    expect(newspaper).toContain('EXECUTE completed successfully');
    expect(newspaper).toContain('Checks: 2 passed');

    const logs = checksLogFiles();
    expect(logs).toHaveLength(1);
    const logContent = fs.readFileSync(
      join(tmpDir, '.angels', '_logs', 'src-auth', logs[0]),
      'utf-8',
    );
    expect(logContent).toContain('check: always-ok');
    expect(logContent).toContain('checks ran fine');
  });

  it('fails the execute when a check exits non-zero', async () => {
    const briefPath = writeReviewBrief();
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      { FAKE_BACKEND_VERDICT: 'done' },
      'checks-fail-wrapper.sh',
    );
    updateConfig(
      tmpDir,
      wrapperPath,
      angelsWithChecks([{ name: 'always-fail', cmd: 'echo boom output; exit 3' }]),
    );

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);
    expect(exitCode).toBe(1);

    const newspaper = fs.readFileSync(join(tmpDir, '.angels', '_newspaper.md'), 'utf-8');
    expect(newspaper).toContain('EXECUTE failed proof-of-done checks');
    expect(newspaper).toContain('always-fail (exit 3)');

    const logs = checksLogFiles();
    expect(logs).toHaveLength(1);
    const logContent = fs.readFileSync(
      join(tmpDir, '.angels', '_logs', 'src-auth', logs[0]),
      'utf-8',
    );
    expect(logContent).toContain('boom output');
    expect(logContent).toContain('exit=3');
  });

  it('does not run checks when the verdict is not done', async () => {
    const briefPath = writeReviewBrief();
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      { FAKE_BACKEND_VERDICT: 'error', FAKE_BACKEND_CONCERNS: 'backend blew up' },
      'checks-error-wrapper.sh',
    );
    updateConfig(
      tmpDir,
      wrapperPath,
      angelsWithChecks([{ name: 'never-runs', cmd: 'echo should not appear' }]),
    );

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);
    expect(exitCode).toBe(1);

    expect(checksLogFiles()).toHaveLength(0);
    const newspaper = fs.readFileSync(join(tmpDir, '.angels', '_newspaper.md'), 'utf-8');
    expect(newspaper).not.toContain('Checks');
  });

  it('runs no checks when none are configured (unchanged behavior)', async () => {
    const briefPath = writeReviewBrief();
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      { FAKE_BACKEND_VERDICT: 'done' },
      'checks-none-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const exitCode = await executeAngel(tmpDir, 'src-auth', briefPath);
    expect(exitCode).toBe(0);
    expect(checksLogFiles()).toHaveLength(0);
  });
});
