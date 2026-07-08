import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { angelCursorFile } from '../paths/layout.js';

/**
 * Newspaper cursors are stored per angel as a JSON document:
 *
 *   { "generation": 3, "offset": 18240 }
 *
 * `generation` is the newspaper generation the offset was taken against
 * (see getNewspaperGeneration). When the newspaper rotates, stored cursors
 * reference an archived generation; getCursor detects the mismatch, prints a
 * notice, and restarts from 0 so entries are re-presented rather than
 * silently skipped (at-least-once delivery).
 */

interface CursorDocument {
  generation: number;
  offset: number;
}

/**
 * Get the current newspaper cursor (byte offset) for an angel, validated
 * against the current newspaper generation.
 *
 * Returns 0 when: no cursor exists yet, the cursor belongs to an archived
 * generation, or the cursor file predates the generation format.
 */
export function getCursor(
  projectRoot: string,
  angelId: string,
  currentGeneration: number,
): number {
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

  let doc: CursorDocument;
  try {
    doc = parseCursorDocument(content);
  } catch {
    process.stderr.write(
      `[guard-angels] cursor for "${angelId}" is not in the generation format ` +
        `(pre-0.3 file or corrupted): restarting from the top of the current newspaper.\n`,
    );
    return 0;
  }

  if (doc.generation !== currentGeneration) {
    process.stderr.write(
      `[guard-angels] cursor for "${angelId}" points at newspaper generation ` +
        `${doc.generation}, current is ${currentGeneration} (rotated). ` +
        `Restarting from the top; archived entries live in .angels/_archive/newspaper/.\n`,
    );
    return 0;
  }

  return doc.offset;
}

/**
 * Set the newspaper cursor (byte offset) for an angel, stamped with the
 * newspaper generation it was read against.
 *
 * Creates the cursors directory if it doesn't exist.
 * Writes atomically via tmpfile + rename.
 */
export function setCursor(
  projectRoot: string,
  angelId: string,
  offset: number,
  generation: number,
): void {
  if (offset < 0 || !Number.isInteger(offset)) {
    throw new Error(
      `Invalid cursor offset: expected a non-negative integer, got ${offset}`,
    );
  }
  if (generation < 1 || !Number.isInteger(generation)) {
    throw new Error(
      `Invalid cursor generation: expected a positive integer, got ${generation}`,
    );
  }

  const cursorPath = angelCursorFile(projectRoot, angelId);

  // Ensure the cursors directory exists
  fs.mkdirSync(dirname(cursorPath), { recursive: true });

  // Atomic write: write to temp file, then rename
  const doc: CursorDocument = { generation, offset };
  const tmpPath = cursorPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(doc) + '\n', 'utf-8');
  fs.renameSync(tmpPath, cursorPath);
}

function parseCursorDocument(content: string): CursorDocument {
  const parsed: unknown = JSON.parse(content);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('cursor document is not an object');
  }
  const doc = parsed as Record<string, unknown>;
  if (
    typeof doc.generation !== 'number' ||
    !Number.isInteger(doc.generation) ||
    doc.generation < 1 ||
    typeof doc.offset !== 'number' ||
    !Number.isInteger(doc.offset) ||
    doc.offset < 0
  ) {
    throw new Error('cursor document has invalid generation/offset');
  }
  return { generation: doc.generation, offset: doc.offset };
}
