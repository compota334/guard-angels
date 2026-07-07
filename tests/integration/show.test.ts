import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { showAngel } from '../../src/commands/show.js';
import { writeAngelMd } from '../../src/angels/memory.js';
import { setupProject, copyFakeBackend } from '../helpers/setup-project.js';

describe('showAngel', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-show-'));
    const fakeBackendPath = copyFakeBackend(tmpDir);
    setupProject(tmpDir, { backendScript: fakeBackendPath });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints angel.md content for a registered angel', () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));

    try {
      showAngel(tmpDir, 'src-auth');
    } finally {
      console.log = origLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('=== angel.md: src-auth ===');
    expect(output).toContain('Path:');
    expect(output).toContain('angel.md');
    expect(output).toContain('Charter');
  });

  it('throws clear error when angel is not in registry', () => {
    expect(() => showAngel(tmpDir, 'nonexistent')).toThrow();
  });

  it('throws clear error when angel.md file is missing', () => {
    // Remove the angel.md file to simulate a missing file
    const angelMdPath = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
    if (fs.existsSync(angelMdPath)) {
      fs.unlinkSync(angelMdPath);
    }

    expect(() => showAngel(tmpDir, 'src-auth')).toThrow(/no angel\.md/);
  });

  it('warns when angel.md has no body content', () => {
    // Write angel.md with only frontmatter
    const angelMdPath = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
    writeAngelMd(angelMdPath, {
      frontmatter: {
        status: 'draft',
        last_updated: '2026-05-16T10:00:00Z',
        last_updated_by: 'main',
      },
      body: '',
    });

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

    try {
      showAngel(tmpDir, 'src-auth');
    } finally {
      console.warn = origWarn;
    }

    expect(warnings.join('\n')).toContain('no body content');
  });
});
