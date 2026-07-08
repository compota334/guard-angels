import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { guardCheckPath } from '../../src/commands/guard-check.js';
import {
  installHooks,
  uninstallHooks,
  hooksStatus,
  isHookInstalled,
  settingsFilePath,
} from '../../src/commands/hooks.js';
import { writeAngelMd } from '../../src/angels/memory.js';
import { copyFakeBackend, setupProject } from '../helpers/setup-project.js';

describe('guardCheckPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-guard-'));
    const fakeBackendPath = copyFakeBackend(tmpDir);
    // setupProject registers _root + src-auth, both ACTIVE
    setupProject(tmpDir, { backendScript: fakeBackendPath });
    delete process.env.GUARD_ANGELS_EXECUTING;
  });

  afterEach(() => {
    delete process.env.GUARD_ANGELS_EXECUTING;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocks a path inside an active folder territory', () => {
    const result = guardCheckPath(tmpDir, 'src/auth/session.ts');
    expect(result.allowed).toBe(false);
    expect(result.angelId).toBe('src-auth');
  });

  it('blocks the territory directory itself', () => {
    const result = guardCheckPath(tmpDir, 'src/auth');
    expect(result.allowed).toBe(false);
  });

  it('blocks new (not yet existing) files inside the territory', () => {
    const result = guardCheckPath(tmpDir, 'src/auth/new-file.ts');
    expect(result.allowed).toBe(false);
  });

  it('allows paths outside any folder territory (root never blocks)', () => {
    expect(guardCheckPath(tmpDir, 'README.md').allowed).toBe(true);
    expect(guardCheckPath(tmpDir, 'src/other/file.ts').allowed).toBe(true);
  });

  it('allows paths outside the project root', () => {
    expect(guardCheckPath(tmpDir, '/etc/hostname').allowed).toBe(true);
  });

  it('does not block for a draft angel', () => {
    writeAngelMd(join(tmpDir, '.angels', 'src', 'auth', 'angel.md'), {
      frontmatter: {
        status: 'draft',
        last_updated: '2026-04-28T10:00:00Z',
        last_updated_by: 'main',
      },
      body: '# Angel: src/auth (folder)\n',
    });

    expect(guardCheckPath(tmpDir, 'src/auth/session.ts').allowed).toBe(true);
  });

  it('exempts the angel subprocess via GUARD_ANGELS_EXECUTING', () => {
    process.env.GUARD_ANGELS_EXECUTING = 'src-auth';
    const result = guardCheckPath(tmpDir, 'src/auth/session.ts');
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('exempt');
  });

  it('allows everything in a project without .angels', () => {
    const bare = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-bare-'));
    try {
      expect(guardCheckPath(bare, 'src/anything.ts').allowed).toBe(true);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('hooks install/status/uninstall', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-hooks-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('install creates .claude/settings.json with the PreToolUse hook', () => {
    expect(installHooks(tmpDir)).toBe(0);

    const settings = JSON.parse(fs.readFileSync(settingsFilePath(tmpDir), 'utf-8'));
    const entries = settings.hooks.PreToolUse as Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toContain('Edit');
    expect(entries[0].matcher).toContain('Write');
    expect(entries[0].hooks[0].command).toBe('angels guard-check --hook');
    expect(isHookInstalled(tmpDir)).toBe(true);
  });

  it('install is idempotent', () => {
    installHooks(tmpDir);
    installHooks(tmpDir);

    const settings = JSON.parse(fs.readFileSync(settingsFilePath(tmpDir), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it('install preserves unrelated settings and hooks', () => {
    fs.mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsFilePath(tmpDir),
      JSON.stringify({
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other-hook' }] },
          ],
        },
      }),
      'utf-8',
    );

    installHooks(tmpDir);

    const settings = JSON.parse(fs.readFileSync(settingsFilePath(tmpDir), 'utf-8'));
    expect(settings.permissions.allow).toEqual(['Bash(npm test)']);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
  });

  it('throws on malformed settings.json instead of clobbering it', () => {
    fs.mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsFilePath(tmpDir), '{ not json', 'utf-8');

    expect(() => installHooks(tmpDir)).toThrow(/Cannot parse/);
  });

  it('status reports 0 when installed, 1 when not', () => {
    expect(hooksStatus(tmpDir)).toBe(1);
    installHooks(tmpDir);
    expect(hooksStatus(tmpDir)).toBe(0);
  });

  it('uninstall removes only the guard entry', () => {
    fs.mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsFilePath(tmpDir),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other-hook' }] },
          ],
        },
      }),
      'utf-8',
    );
    installHooks(tmpDir);
    expect(isHookInstalled(tmpDir)).toBe(true);

    expect(uninstallHooks(tmpDir)).toBe(0);
    expect(isHookInstalled(tmpDir)).toBe(false);

    const settings = JSON.parse(fs.readFileSync(settingsFilePath(tmpDir), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Bash');
  });

  it('uninstall drops empty hook structures entirely', () => {
    installHooks(tmpDir);
    uninstallHooks(tmpDir);

    const settings = JSON.parse(fs.readFileSync(settingsFilePath(tmpDir), 'utf-8'));
    expect(settings.hooks).toBeUndefined();
  });
});
