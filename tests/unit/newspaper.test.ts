import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendNewspaper,
  readNewspaperSince,
  formatNewspaperEntry,
  getNewspaperSize,
  getNewspaperGeneration,
  rotateNewspaperIfOver,
} from '../../src/messaging/newspaper.js';
import type { NewspaperEntry } from '../../src/messaging/newspaper.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newspaper-test-'));
  // Create the .angels/ directory since layout.ts expects it
  fs.mkdirSync(path.join(tmpDir, '.angels'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function newspaperPath(): string {
  return path.join(tmpDir, '.angels', '_newspaper.md');
}

const entry1: NewspaperEntry = {
  timestamp: '2026-04-28T14:00:00Z',
  angelId: 'src-auth',
  summary: 'EXECUTE completed successfully.',
  details: 'Files changed: src/auth/session.ts',
};

const entry2: NewspaperEntry = {
  timestamp: '2026-04-28T15:00:00Z',
  angelId: 'src-api',
  summary: 'EXECUTE completed successfully.',
};

const entry3: NewspaperEntry = {
  timestamp: '2026-04-28T16:00:00Z',
  angelId: '_root',
  summary: 'Sweep completed. No drift detected.',
  details: 'All invariants hold.',
};

describe('formatNewspaperEntry', () => {
  it('formats entry with details', () => {
    const formatted = formatNewspaperEntry(entry1);
    expect(formatted).toBe(
      '## 2026-04-28T14:00:00Z [src-auth]\n' +
        'EXECUTE completed successfully.\n' +
        'Files changed: src/auth/session.ts\n' +
        '\n',
    );
  });

  it('formats entry without details', () => {
    const formatted = formatNewspaperEntry(entry2);
    expect(formatted).toBe(
      '## 2026-04-28T15:00:00Z [src-api]\n' +
        'EXECUTE completed successfully.\n' +
        '\n',
    );
  });
});

describe('appendNewspaper', () => {
  it('creates the newspaper file if it does not exist', () => {
    appendNewspaper(tmpDir, entry1);
    expect(fs.existsSync(newspaperPath())).toBe(true);
    const content = fs.readFileSync(newspaperPath(), 'utf-8');
    expect(content).toContain('## 2026-04-28T14:00:00Z [src-auth]');
    expect(content).toContain('EXECUTE completed successfully.');
  });

  it('appends multiple entries sequentially', () => {
    appendNewspaper(tmpDir, entry1);
    appendNewspaper(tmpDir, entry2);
    appendNewspaper(tmpDir, entry3);

    const content = fs.readFileSync(newspaperPath(), 'utf-8');
    expect(content).toContain('[src-auth]');
    expect(content).toContain('[src-api]');
    expect(content).toContain('[_root]');

    // Verify order: src-auth appears before src-api
    const authIdx = content.indexOf('[src-auth]');
    const apiIdx = content.indexOf('[src-api]');
    const rootIdx = content.indexOf('[_root]');
    expect(authIdx).toBeLessThan(apiIdx);
    expect(apiIdx).toBeLessThan(rootIdx);
  });

  it('does not corrupt existing content when appending', () => {
    // Pre-write some content
    fs.writeFileSync(
      newspaperPath(),
      '## 2026-04-28T13:00:00Z [existing]\nSome pre-existing entry.\n\n',
      'utf-8',
    );

    appendNewspaper(tmpDir, entry1);

    const content = fs.readFileSync(newspaperPath(), 'utf-8');
    expect(content).toContain('[existing]');
    expect(content).toContain('[src-auth]');
  });

  it('truncates oversized details to keep the append atomic (< 4096 bytes)', () => {
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T14:00:00Z',
      angelId: 'src-auth',
      summary: 'EXECUTE completed successfully.',
      details: 'x'.repeat(10_000),
    });

    const content = fs.readFileSync(newspaperPath(), 'utf-8');
    expect(Buffer.byteLength(content, 'utf-8')).toBeLessThan(4096);
    expect(content).toContain('[details truncated');

    // The entry must still parse as a single well-formed entry
    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].angelId).toBe('src-auth');
  });

  it('leaves normal-sized details untouched', () => {
    appendNewspaper(tmpDir, entry3);
    const content = fs.readFileSync(newspaperPath(), 'utf-8');
    expect(content).toContain('All invariants hold.');
    expect(content).not.toContain('[details truncated');
  });
});

describe('readNewspaperSince', () => {
  it('returns empty array when newspaper file does not exist', () => {
    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries).toEqual([]);
  });

  it('returns all entries when cursor is 0', () => {
    appendNewspaper(tmpDir, entry1);
    appendNewspaper(tmpDir, entry2);

    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries).toHaveLength(2);
    expect(entries[0].angelId).toBe('src-auth');
    expect(entries[1].angelId).toBe('src-api');
  });

  it('returns only entries after the cursor byte offset', () => {
    appendNewspaper(tmpDir, entry1);
    const cursorAfterFirst = getNewspaperSize(tmpDir);
    appendNewspaper(tmpDir, entry2);

    const entries = readNewspaperSince(tmpDir, cursorAfterFirst);
    expect(entries).toHaveLength(1);
    expect(entries[0].angelId).toBe('src-api');
    expect(entries[0].timestamp).toBe('2026-04-28T15:00:00Z');
  });

  it('returns empty array when cursor is at EOF', () => {
    appendNewspaper(tmpDir, entry1);
    const cursorAtEnd = getNewspaperSize(tmpDir);

    const entries = readNewspaperSince(tmpDir, cursorAtEnd);
    expect(entries).toEqual([]);
  });

  it('returns entries with correct offsets', () => {
    appendNewspaper(tmpDir, entry1);
    appendNewspaper(tmpDir, entry2);

    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries).toHaveLength(2);

    // First entry should start at offset 0
    expect(entries[0].offset).toBe(0);

    // Second entry offset should be > 0
    expect(entries[1].offset).toBeGreaterThan(0);
  });

  it('handles negative cursor by reading from beginning', () => {
    appendNewspaper(tmpDir, entry1);

    const entries = readNewspaperSince(tmpDir, -10);
    expect(entries).toHaveLength(1);
    expect(entries[0].angelId).toBe('src-auth');
  });

  it('parses entry body correctly', () => {
    appendNewspaper(tmpDir, entry1);

    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toContain('EXECUTE completed successfully.');
    expect(entries[0].body).toContain('Files changed: src/auth/session.ts');
  });

  it('skips partially-written entries without valid headers', () => {
    // Write a complete entry followed by a partial one (no valid header)
    const content =
      '## 2026-04-28T14:00:00Z [src-auth]\n' +
      'Complete entry.\n' +
      '\n';
    fs.writeFileSync(newspaperPath(), content, 'utf-8');

    // Append raw garbage that doesn't have a valid entry header
    fs.appendFileSync(
      newspaperPath(),
      'partial garbage without header\nmore garbage\n',
      'utf-8',
    );

    const entries = readNewspaperSince(tmpDir, 0);
    // The garbage after the first entry should not produce a separate entry
    // but the garbage IS attached to the first entry's body
    expect(entries).toHaveLength(1);
    expect(entries[0].angelId).toBe('src-auth');
  });

  it('safely ignores text before first entry header', () => {
    // Write some preamble before the first valid entry
    const content =
      'This is preamble text, not an entry.\n\n' +
      '## 2026-04-28T14:00:00Z [src-auth]\n' +
      'First real entry.\n\n';
    fs.writeFileSync(newspaperPath(), content, 'utf-8');

    const entries = readNewspaperSince(tmpDir, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].angelId).toBe('src-auth');
  });
});

describe('getNewspaperSize', () => {
  it('returns 0 when file does not exist', () => {
    expect(getNewspaperSize(tmpDir)).toBe(0);
  });

  it('returns correct byte size after appending', () => {
    appendNewspaper(tmpDir, entry1);
    const size1 = getNewspaperSize(tmpDir);
    expect(size1).toBeGreaterThan(0);

    appendNewspaper(tmpDir, entry2);
    const size2 = getNewspaperSize(tmpDir);
    expect(size2).toBeGreaterThan(size1);
  });

  it('size increases monotonically with each append', () => {
    const sizes: number[] = [getNewspaperSize(tmpDir)];

    appendNewspaper(tmpDir, entry1);
    sizes.push(getNewspaperSize(tmpDir));

    appendNewspaper(tmpDir, entry2);
    sizes.push(getNewspaperSize(tmpDir));

    appendNewspaper(tmpDir, entry3);
    sizes.push(getNewspaperSize(tmpDir));

    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });
});

describe('cursor-based reading workflow', () => {
  it('full workflow: append, read, advance cursor, read again', () => {
    // Append first entry
    appendNewspaper(tmpDir, entry1);
    const cursorAfterFirst = getNewspaperSize(tmpDir);

    // Read all — should get entry1
    const all = readNewspaperSince(tmpDir, 0);
    expect(all).toHaveLength(1);

    // Append second entry
    appendNewspaper(tmpDir, entry2);

    // Read since first cursor — should only get entry2
    const newEntries = readNewspaperSince(tmpDir, cursorAfterFirst);
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0].angelId).toBe('src-api');

    // Advance cursor to current end
    const cursorAfterSecond = getNewspaperSize(tmpDir);

    // Read since second cursor — should get nothing
    const noEntries = readNewspaperSince(tmpDir, cursorAfterSecond);
    expect(noEntries).toEqual([]);

    // Append third entry
    appendNewspaper(tmpDir, entry3);

    // Read since second cursor — should only get entry3
    const latestEntries = readNewspaperSince(tmpDir, cursorAfterSecond);
    expect(latestEntries).toHaveLength(1);
    expect(latestEntries[0].angelId).toBe('_root');
  });
});

describe('newspaper rotation', () => {
  it('generation defaults to 1 when no generation file exists', () => {
    expect(getNewspaperGeneration(tmpDir)).toBe(1);
  });

  it('does not rotate below the size threshold', () => {
    appendNewspaper(tmpDir, entry1);
    const result = rotateNewspaperIfOver(tmpDir, 1_000_000);
    expect(result.rotated).toBe(false);
    expect(getNewspaperGeneration(tmpDir)).toBe(1);
  });

  it('does not rotate an empty newspaper even with force', () => {
    fs.writeFileSync(newspaperPath(), '', 'utf-8');
    const result = rotateNewspaperIfOver(tmpDir, 10, true);
    expect(result.rotated).toBe(false);
  });

  it('rotates when the newspaper exceeds the threshold', () => {
    appendNewspaper(tmpDir, entry1);
    appendNewspaper(tmpDir, entry2);
    const sizeBefore = getNewspaperSize(tmpDir);
    expect(sizeBefore).toBeGreaterThan(10);

    const result = rotateNewspaperIfOver(tmpDir, 10);

    expect(result.rotated).toBe(true);
    expect(result.archivePath).toMatch(/_archive\/newspaper\/\d{4}-\d{2}-gen1\.md$/);
    expect(fs.existsSync(result.archivePath!)).toBe(true);

    // Archived content is the old newspaper
    const archived = fs.readFileSync(result.archivePath!, 'utf-8');
    expect(archived).toContain('[src-auth]');

    // Fresh newspaper + bumped generation
    expect(getNewspaperSize(tmpDir)).toBe(0);
    expect(getNewspaperGeneration(tmpDir)).toBe(2);
  });

  it('subsequent rotations use increasing generations', () => {
    appendNewspaper(tmpDir, entry1);
    const first = rotateNewspaperIfOver(tmpDir, 1);
    appendNewspaper(tmpDir, entry2);
    const second = rotateNewspaperIfOver(tmpDir, 1);

    expect(first.archivePath).toMatch(/gen1\.md$/);
    expect(second.archivePath).toMatch(/gen2\.md$/);
    expect(getNewspaperGeneration(tmpDir)).toBe(3);
  });

  it('throws on a malformed generation file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.angels', '_newspaper.generation'),
      'garbage',
      'utf-8',
    );
    expect(() => getNewspaperGeneration(tmpDir)).toThrow(/Malformed newspaper generation/);
  });
});
