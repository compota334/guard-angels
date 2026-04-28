import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getCursor, setCursor } from '../../src/messaging/cursors.js';

let tmpDir: string;

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
    const offset = getCursor(tmpDir, 'src-auth');
    expect(offset).toBe(0);
  });

  it('returns the stored byte offset', () => {
    fs.writeFileSync(cursorPath('src-auth'), '1234\n', 'utf-8');
    const offset = getCursor(tmpDir, 'src-auth');
    expect(offset).toBe(1234);
  });

  it('handles zero offset', () => {
    fs.writeFileSync(cursorPath('src-auth'), '0\n', 'utf-8');
    const offset = getCursor(tmpDir, 'src-auth');
    expect(offset).toBe(0);
  });

  it('handles offset without trailing newline', () => {
    fs.writeFileSync(cursorPath('src-auth'), '5678', 'utf-8');
    const offset = getCursor(tmpDir, 'src-auth');
    expect(offset).toBe(5678);
  });

  it('returns 0 for empty cursor file', () => {
    fs.writeFileSync(cursorPath('src-auth'), '', 'utf-8');
    const offset = getCursor(tmpDir, 'src-auth');
    expect(offset).toBe(0);
  });

  it('throws on non-numeric cursor content', () => {
    fs.writeFileSync(cursorPath('src-auth'), 'abc', 'utf-8');
    expect(() => getCursor(tmpDir, 'src-auth')).toThrow(
      /Malformed cursor file/,
    );
  });

  it('throws on negative cursor value', () => {
    fs.writeFileSync(cursorPath('src-auth'), '-5', 'utf-8');
    expect(() => getCursor(tmpDir, 'src-auth')).toThrow(
      /Malformed cursor file/,
    );
  });

  it('works with different angel IDs', () => {
    fs.writeFileSync(cursorPath('src-auth'), '100\n', 'utf-8');
    fs.writeFileSync(cursorPath('src-api'), '200\n', 'utf-8');
    fs.writeFileSync(cursorPath('_root'), '300\n', 'utf-8');

    expect(getCursor(tmpDir, 'src-auth')).toBe(100);
    expect(getCursor(tmpDir, 'src-api')).toBe(200);
    expect(getCursor(tmpDir, '_root')).toBe(300);
  });
});

describe('setCursor', () => {
  it('writes the cursor file with the offset', () => {
    setCursor(tmpDir, 'src-auth', 1234);
    const content = fs.readFileSync(cursorPath('src-auth'), 'utf-8');
    expect(content.trim()).toBe('1234');
  });

  it('overwrites an existing cursor', () => {
    setCursor(tmpDir, 'src-auth', 100);
    setCursor(tmpDir, 'src-auth', 200);
    expect(getCursor(tmpDir, 'src-auth')).toBe(200);
  });

  it('creates the cursors directory if missing', () => {
    // Remove the pre-created directory
    fs.rmSync(path.join(tmpDir, '.angels', '_cursors'), {
      recursive: true,
      force: true,
    });

    setCursor(tmpDir, 'src-auth', 500);
    expect(getCursor(tmpDir, 'src-auth')).toBe(500);
  });

  it('sets cursor to 0', () => {
    setCursor(tmpDir, 'src-auth', 0);
    expect(getCursor(tmpDir, 'src-auth')).toBe(0);
  });

  it('throws on negative offset', () => {
    expect(() => setCursor(tmpDir, 'src-auth', -1)).toThrow(
      /Invalid cursor offset/,
    );
  });

  it('throws on non-integer offset', () => {
    expect(() => setCursor(tmpDir, 'src-auth', 1.5)).toThrow(
      /Invalid cursor offset/,
    );
  });

  it('does not leave tmp files on success', () => {
    setCursor(tmpDir, 'src-auth', 1234);
    const files = fs.readdirSync(path.join(tmpDir, '.angels', '_cursors'));
    // Should contain only the cursor file itself, no .tmp files
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });
});

describe('getCursor + setCursor round-trip', () => {
  it('round-trips correctly', () => {
    setCursor(tmpDir, 'src-auth', 42);
    expect(getCursor(tmpDir, 'src-auth')).toBe(42);
  });

  it('round-trips large offsets', () => {
    const largeOffset = 10_000_000;
    setCursor(tmpDir, 'src-auth', largeOffset);
    expect(getCursor(tmpDir, 'src-auth')).toBe(largeOffset);
  });

  it('independent per angel', () => {
    setCursor(tmpDir, 'src-auth', 100);
    setCursor(tmpDir, 'src-api', 200);

    expect(getCursor(tmpDir, 'src-auth')).toBe(100);
    expect(getCursor(tmpDir, 'src-api')).toBe(200);

    // Update one, other is unchanged
    setCursor(tmpDir, 'src-auth', 150);
    expect(getCursor(tmpDir, 'src-auth')).toBe(150);
    expect(getCursor(tmpDir, 'src-api')).toBe(200);
  });
});
