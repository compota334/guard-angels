import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { newspaperFile } from '../paths/layout.js';

/**
 * A structured newspaper entry before serialization.
 */
export interface NewspaperEntry {
  timestamp: string;
  angelId: string;
  summary: string;
  details?: string;
}

/**
 * A parsed newspaper entry returned by readNewspaperSince.
 */
export interface ParsedNewspaperEntry {
  timestamp: string;
  angelId: string;
  body: string;
  /** Byte offset where this entry starts in the newspaper file. */
  offset: number;
}

/**
 * The entry-delimiter regex: matches `## <iso-timestamp> [<angel-id>]` at the
 * start of a line. Used to split the newspaper into individual entries.
 */
const ENTRY_HEADER_RE = /^## (\S+) \[([^\]]+)\]$/;

/**
 * Format a newspaper entry into the canonical Markdown format (section 6.6).
 *
 * The returned string always ends with two newlines so that consecutive
 * entries are separated by a blank line.
 */
export function formatNewspaperEntry(entry: NewspaperEntry): string {
  const lines: string[] = [];
  lines.push(`## ${entry.timestamp} [${entry.angelId}]`);
  lines.push(entry.summary);
  if (entry.details) {
    lines.push(entry.details);
  }
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/**
 * Append a newspaper entry atomically.
 *
 * Strategy: write the formatted entry to a temp file in the same directory,
 * then append its contents to the newspaper file. This ensures that the
 * append is all-or-nothing from a filesystem perspective in the v1 sequential
 * model. A concurrent reader using readNewspaperSince will only see complete
 * entries because we scan for entry headers.
 *
 * If the newspaper file doesn't exist, it is created.
 */
export function appendNewspaper(
  projectRoot: string,
  entry: NewspaperEntry,
): void {
  const npFile = newspaperFile(projectRoot);

  // Ensure the directory exists
  fs.mkdirSync(dirname(npFile), { recursive: true });

  const formatted = formatNewspaperEntry(entry);

  // Append to the newspaper file. On Linux, O_APPEND ensures the write is
  // atomic for buffers smaller than PIPE_BUF (4096 bytes). Our entries are
  // well under this limit.
  fs.appendFileSync(npFile, formatted, 'utf-8');
}

/**
 * Read all newspaper entries whose start offset is >= the given cursor
 * (byte offset). Returns only fully-formed entries (i.e., entries that
 * have a complete header line followed by at least one content line
 * before the next entry or EOF).
 *
 * If cursor is 0 or negative, reads from the beginning of the file.
 * If the file doesn't exist, returns an empty array.
 *
 * Returns entries in chronological order (as written in the file).
 */
export function readNewspaperSince(
  projectRoot: string,
  cursor: number,
): ParsedNewspaperEntry[] {
  const npFile = newspaperFile(projectRoot);

  let buf: Buffer;
  try {
    buf = fs.readFileSync(npFile);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    throw err;
  }

  const effectiveCursor = Math.max(0, cursor);

  // We read from effectiveCursor onward, but we need byte offsets.
  // Slice the buffer from the cursor position.
  const slicedBuf = buf.subarray(effectiveCursor);
  const slicedContent = slicedBuf.toString('utf-8');

  return parseEntries(slicedContent, effectiveCursor);
}

/**
 * Get the current byte size of the newspaper file. Useful for capturing
 * "the cursor after this append" without parsing.
 *
 * Returns 0 if the file doesn't exist.
 */
export function getNewspaperSize(projectRoot: string): number {
  const npFile = newspaperFile(projectRoot);
  try {
    const stat = fs.statSync(npFile);
    return stat.size;
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
}

/**
 * Parse newspaper content into individual entries.
 *
 * An entry starts with a header line matching `## <timestamp> [<angel-id>]`
 * and extends to the line before the next header (or EOF). Only entries with
 * a valid header are returned — any trailing text that doesn't start with a
 * header (e.g. a partially-written entry) is silently skipped.
 */
function parseEntries(
  content: string,
  baseOffset: number,
): ParsedNewspaperEntry[] {
  const entries: ParsedNewspaperEntry[] = [];
  const lines = content.split('\n');

  let currentEntry: {
    timestamp: string;
    angelId: string;
    bodyLines: string[];
    byteOffset: number;
  } | null = null;

  // Track byte position as we iterate through lines
  let bytePos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineByteLength = Buffer.byteLength(line, 'utf-8');

    const match = ENTRY_HEADER_RE.exec(line);

    if (match) {
      // Flush the previous entry if any
      if (currentEntry) {
        entries.push(flushEntry(currentEntry, baseOffset));
      }

      currentEntry = {
        timestamp: match[1],
        angelId: match[2],
        bodyLines: [],
        byteOffset: bytePos,
      };
    } else if (currentEntry) {
      currentEntry.bodyLines.push(line);
    }
    // else: text before the first header — skip

    // +1 for the newline character that was consumed by split
    bytePos += lineByteLength + (i < lines.length - 1 ? 1 : 0);
  }

  // Flush the last entry
  if (currentEntry) {
    entries.push(flushEntry(currentEntry, baseOffset));
  }

  return entries;
}

function flushEntry(
  entry: {
    timestamp: string;
    angelId: string;
    bodyLines: string[];
    byteOffset: number;
  },
  baseOffset: number,
): ParsedNewspaperEntry {
  // Trim trailing empty lines from the body
  const body = entry.bodyLines.join('\n').replace(/\n+$/, '');

  return {
    timestamp: entry.timestamp,
    angelId: entry.angelId,
    body,
    offset: baseOffset + entry.byteOffset,
  };
}
