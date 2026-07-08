import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getCursor, setCursor } from '../../src/messaging/cursors.js';

let tmpDir: string;

const GEN = 1;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursors-test-'));
  // Create the .angels/_cursors directory
  fs.mkdirSync(path.join(tmpDir, '.angels', '_cursors'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function cursorPath(angelId: string): string {
  return path.join(tmpDir, '.angels', '_cursors', angelId);
}

describe('getCursor', () => {
  it('returns 0 when cursor file does not exist', () => {
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(0);
  });

  it('returns the stored byte offset for the matching generation', () => {
    fs.writeFileSync(cursorPath('src-auth'), '{"generation":1,"offset":1234}\n', 'utf-8');
    expect(getCursor(tmpDir, 'src-auth', 1)).toBe(1234);
  });

  it('returns 0 for empty cursor file', () => {
    fs.writeFileSync(cursorPath('src-auth'), '', 'utf-8');
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(0);
  });

  it('resets to 0 when the stored generation does not match (rotation)', () => {
    fs.writeFileSync(cursorPath('src-auth'), '{"generation":1,"offset":1234}\n', 'utf-8');
    expect(getCursor(tmpDir, 'src-auth', 2)).toBe(0);
  });

  it('resets to 0 on a pre-generation (plain number) cursor file', () => {
    fs.writeFileSync(cursorPath('src-auth'), '1234\n', 'utf-8');
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(0);
  });

  it('resets to 0 on corrupted cursor content', () => {
    fs.writeFileSync(cursorPath('src-auth'), 'not json at all', 'utf-8');
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(0);
  });

  it('resets to 0 on JSON with invalid fields', () => {
    fs.writeFileSync(cursorPath('src-auth'), '{"generation":0,"offset":-4}', 'utf-8');
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(0);
  });

  it('works with different angel IDs', () => {
    setCursor(tmpDir, 'src-auth', 100, GEN);
    setCursor(tmpDir, 'src-api', 200, GEN);
    setCursor(tmpDir, '_root', 300, GEN);

    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(100);
    expect(getCursor(tmpDir, 'src-api', GEN)).toBe(200);
    expect(getCursor(tmpDir, '_root', GEN)).toBe(300);
  });
});

describe('setCursor', () => {
  it('writes a generation-stamped JSON document', () => {
    setCursor(tmpDir, 'src-auth', 1234, 3);
    const content = fs.readFileSync(cursorPath('src-auth'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ generation: 3, offset: 1234 });
  });

  it('overwrites an existing cursor', () => {
    setCursor(tmpDir, 'src-auth', 100, GEN);
    setCursor(tmpDir, 'src-auth', 200, GEN);
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(200);
  });

  it('creates the cursors directory if missing', () => {
    fs.rmSync(path.join(tmpDir, '.angels', '_cursors'), {
      recursive: true,
      force: true,
    });

    setCursor(tmpDir, 'src-auth', 500, GEN);
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(500);
  });

  it('sets cursor to 0', () => {
    setCursor(tmpDir, 'src-auth', 0, GEN);
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(0);
  });

  it('throws on negative offset', () => {
    expect(() => setCursor(tmpDir, 'src-auth', -1, GEN)).toThrow(/Invalid cursor offset/);
  });

  it('throws on non-integer offset', () => {
    expect(() => setCursor(tmpDir, 'src-auth', 1.5, GEN)).toThrow(/Invalid cursor offset/);
  });

  it('throws on invalid generation', () => {
    expect(() => setCursor(tmpDir, 'src-auth', 10, 0)).toThrow(/Invalid cursor generation/);
    expect(() => setCursor(tmpDir, 'src-auth', 10, 1.5)).toThrow(/Invalid cursor generation/);
  });

  it('does not leave tmp files on success', () => {
    setCursor(tmpDir, 'src-auth', 1234, GEN);
    const files = fs.readdirSync(path.join(tmpDir, '.angels', '_cursors'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });
});

describe('getCursor + setCursor round-trip', () => {
  it('round-trips correctly', () => {
    setCursor(tmpDir, 'src-auth', 42, GEN);
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(42);
  });

  it('round-trips large offsets', () => {
    const largeOffset = 10_000_000;
    setCursor(tmpDir, 'src-auth', largeOffset, GEN);
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(largeOffset);
  });

  it('a cursor written against generation N is stale for generation N+1', () => {
    setCursor(tmpDir, 'src-auth', 42, 1);
    expect(getCursor(tmpDir, 'src-auth', 2)).toBe(0);
    // and re-stamping against the new generation restores normal behavior
    setCursor(tmpDir, 'src-auth', 7, 2);
    expect(getCursor(tmpDir, 'src-auth', 2)).toBe(7);
  });

  it('independent per angel', () => {
    setCursor(tmpDir, 'src-auth', 100, GEN);
    setCursor(tmpDir, 'src-api', 200, GEN);

    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(100);
    expect(getCursor(tmpDir, 'src-api', GEN)).toBe(200);

    // Update one, other is unchanged
    setCursor(tmpDir, 'src-auth', 150, GEN);
    expect(getCursor(tmpDir, 'src-auth', GEN)).toBe(150);
    expect(getCursor(tmpDir, 'src-api', GEN)).toBe(200);
  });
});
