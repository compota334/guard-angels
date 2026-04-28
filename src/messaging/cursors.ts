import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { angelCursorFile } from '../paths/layout.js';

/**
 * Get the current newspaper cursor (byte offset) for an angel.
 *
 * The cursor is stored as a single-line file containing the byte offset.
 * If the cursor file doesn't exist, returns 0 (meaning: read from
 * the beginning of the newspaper).
 *
 * Throws on malformed cursor content (non-numeric).
 */
export function getCursor(projectRoot: string, angelId: string): number {
  const cursorPath = angelCursorFile(projectRoot, angelId);

  let content: string;
  try {
    content = fs.readFileSync(cursorPath, 'utf-8').trim();
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return 0;
    }
    throw err;
  }

  if (content === '') {
    return 0;
  }

  const offset = parseInt(content, 10);
  if (isNaN(offset) || offset < 0) {
    throw new Error(
      `Malformed cursor file at ${cursorPath}: expected a non-negative integer, got "${content}"`,
    );
  }

  return offset;
}

/**
 * Set the newspaper cursor (byte offset) for an angel.
 *
 * Creates the cursors directory if it doesn't exist.
 * Writes atomically via tmpfile + rename.
 */
export function setCursor(
  projectRoot: string,
  angelId: string,
  offset: number,
): void {
  if (offset < 0 || !Number.isInteger(offset)) {
    throw new Error(
      `Invalid cursor offset: expected a non-negative integer, got ${offset}`,
    );
  }

  const cursorPath = angelCursorFile(projectRoot, angelId);

  // Ensure the cursors directory exists
  fs.mkdirSync(dirname(cursorPath), { recursive: true });

  // Atomic write: write to temp file, then rename
  const tmpPath = cursorPath + '.tmp';
  fs.writeFileSync(tmpPath, String(offset) + '\n', 'utf-8');
  fs.renameSync(tmpPath, cursorPath);
}
