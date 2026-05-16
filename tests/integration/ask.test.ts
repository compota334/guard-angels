import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { askAngel } from '../../src/commands/ask.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  setupProject,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('askAngel', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-ask-'));
    fakeBackendPath = copyFakeBackend(tmpDir);
    setupProject(tmpDir, { backendScript: fakeBackendPath });
  });

  afterEach(() => {
    const lp = lockFilePath(tmpDir);
    if (fs.existsSync(lp)) fs.unlinkSync(lp);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns exit code 0 and prints the angel answer', async () => {
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      { FAKE_BACKEND_ANSWER: 'Session tokens live in src/auth/session.ts line 42.' },
      'ask-wrapper.sh',
    );
    updateConfig(tmpDir, wrapperPath);

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));

    let exitCode: number;
    try {
      exitCode = await askAngel(tmpDir, 'src-auth', 'Where are session tokens managed?');
    } finally {
      console.log = origLog;
    }

    expect(exitCode).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('Session tokens live in src/auth/session.ts');
    expect(output).toContain('=== Answer from src-auth ===');
  });

  it('does NOT create a brief file in .angels/_briefs/', async () => {
    await askAngel(tmpDir, 'src-auth', 'What do you own?');

    const briefsDir = join(tmpDir, '.angels', '_briefs', 'src-auth');
    const briefs = fs.existsSync(briefsDir) ? fs.readdirSync(briefsDir) : [];
    expect(briefs.length).toBe(0);
  });

  it('does NOT append a newspaper entry', async () => {
    await askAngel(tmpDir, 'src-auth', 'What do you own?');

    const newspaper = fs.readFileSync(
      join(tmpDir, '.angels', '_newspaper.md'),
      'utf-8',
    );
    expect(newspaper.trim()).toBe('');
  });

  it('releases the lock after invocation', async () => {
    await askAngel(tmpDir, 'src-auth', 'What do you own?');
    expect(fs.existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  it('throws clear error for unknown angel', async () => {
    await expect(askAngel(tmpDir, 'nonexistent', 'Hello?')).rejects.toThrow();
  });
});
