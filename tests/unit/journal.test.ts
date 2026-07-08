import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { appendJournal, MAX_JOURNAL_ENTRIES } from '../../src/angels/journal.js';
import { noteAngel } from '../../src/commands/note.js';
import { readAngelMd, writeAngelMd } from '../../src/angels/memory.js';
import { copyFakeBackend, setupProject } from '../helpers/setup-project.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-journal-'));
  fs.mkdirSync(join(tmpDir, '.angels', 'src', 'auth'), { recursive: true });
  writeAngelMd(mdPath(), {
    frontmatter: {
      status: 'active',
      last_updated: '2026-04-28T10:00:00Z',
      last_updated_by: 'main',
    },
    body: '# Angel: src/auth (folder)\n\n## Charter\nOwns auth.\n\n## Invariants\n- INV-001: tokens are never logged.\n',
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mdPath(): string {
  return join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
}

describe('appendJournal', () => {
  it('creates the ## Journal section on first append', () => {
    appendJournal(tmpDir, 'src-auth', 'src/auth', ['EXECUTE done: "Add logout"']);

    const { body } = readAngelMd(mdPath());
    expect(body).toContain('## Journal');
    expect(body).toContain('EXECUTE done: "Add logout"');
    expect(body).toMatch(/- \[\d{4}-\d{2}-\d{2}T.*\] EXECUTE done/);
    // Curated sections survive
    expect(body).toContain('## Charter');
    expect(body).toContain('INV-001');
  });

  it('appends to an existing journal preserving previous bullets', () => {
    appendJournal(tmpDir, 'src-auth', 'src/auth', ['first fact']);
    appendJournal(tmpDir, 'src-auth', 'src/auth', ['second fact']);

    const { body } = readAngelMd(mdPath());
    const firstIdx = body.indexOf('first fact');
    const secondIdx = body.indexOf('second fact');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    // Only one Journal header
    expect(body.match(/## Journal/g)).toHaveLength(1);
  });

  it('does not touch the frontmatter', () => {
    appendJournal(tmpDir, 'src-auth', 'src/auth', ['a fact']);
    const { frontmatter } = readAngelMd(mdPath());
    expect(frontmatter.last_updated).toBe('2026-04-28T10:00:00Z');
    expect(frontmatter.last_updated_by).toBe('main');
  });

  it('flattens multi-line entries into one bullet', () => {
    appendJournal(tmpDir, 'src-auth', 'src/auth', ['line one\nline two']);
    const { body } = readAngelMd(mdPath());
    expect(body).toContain('line one line two');
  });

  it('caps the journal and rotates overflow to _archive/journal/', () => {
    const many = Array.from({ length: MAX_JOURNAL_ENTRIES + 25 }, (_, i) => `fact ${i}`);
    appendJournal(tmpDir, 'src-auth', 'src/auth', many);

    const { body } = readAngelMd(mdPath());
    const bullets = body.split('\n').filter((l) => l.startsWith('- ['));
    expect(bullets).toHaveLength(MAX_JOURNAL_ENTRIES);
    expect(body).not.toContain('fact 0');
    expect(body).toContain(`fact ${MAX_JOURNAL_ENTRIES + 24}`);

    const archived = fs.readFileSync(
      join(tmpDir, '.angels', '_archive', 'journal', 'src-auth.md'),
      'utf-8',
    );
    expect(archived).toContain('fact 0');
    expect(archived).toContain('fact 24');
    expect(archived).not.toContain('fact 25\n');
  });

  it('preserves sections that come after the journal', () => {
    // Place a Journal section in the middle by hand
    writeAngelMd(mdPath(), {
      frontmatter: {
        status: 'active',
        last_updated: '2026-04-28T10:00:00Z',
        last_updated_by: 'main',
      },
      body:
        '# Angel: src/auth (folder)\n\n## Journal\n\n- [2026-04-28T10:00:00Z] old fact\n\n## Dependencies\nNone.\n',
    });

    appendJournal(tmpDir, 'src-auth', 'src/auth', ['new fact']);

    const { body } = readAngelMd(mdPath());
    expect(body).toContain('old fact');
    expect(body).toContain('new fact');
    expect(body).toContain('## Dependencies');
    expect(body.indexOf('## Dependencies')).toBeGreaterThan(body.indexOf('new fact'));
  });

  it('throws when the angel.md does not exist', () => {
    expect(() => appendJournal(tmpDir, 'src-api', 'src/api', ['x'])).toThrow(
      /Cannot read angel.md/,
    );
  });

  it('is a no-op for an empty entry list', () => {
    const before = fs.readFileSync(mdPath(), 'utf-8');
    appendJournal(tmpDir, 'src-auth', 'src/auth', []);
    expect(fs.readFileSync(mdPath(), 'utf-8')).toBe(before);
  });
});

describe('noteAngel', () => {
  it('appends a note through the registry', () => {
    const projDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-note-'));
    try {
      const fakeBackendPath = copyFakeBackend(projDir);
      setupProject(projDir, { backendScript: fakeBackendPath });

      noteAngel(projDir, 'src-auth', 'remember to refactor sessions');

      const { body } = readAngelMd(join(projDir, '.angels', 'src', 'auth', 'angel.md'));
      expect(body).toContain('## Journal');
      expect(body).toContain('note: remember to refactor sessions');
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown angel', () => {
    const projDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-note2-'));
    try {
      const fakeBackendPath = copyFakeBackend(projDir);
      setupProject(projDir, { backendScript: fakeBackendPath });
      expect(() => noteAngel(projDir, 'src-ghost', 'hello')).toThrow();
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('rejects empty text', () => {
    const projDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-note3-'));
    try {
      const fakeBackendPath = copyFakeBackend(projDir);
      setupProject(projDir, { backendScript: fakeBackendPath });
      expect(() => noteAngel(projDir, 'src-auth', '   ')).toThrow(/empty/);
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });
});
