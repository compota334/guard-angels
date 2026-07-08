import { readdirSync } from 'node:fs';

/**
 * Shared parsing helpers for the on-disk protocol format used by briefs,
 * responses, and cables. All three files share the same flat
 * "FIELD: value" + multi-line "SECTION:\n<body>" shape, so the readers
 * and the filename-sequence logic live in one place.
 *
 * Headers are matched as: a line starting with one or more uppercase
 * letters / underscores / spaces, followed by a colon. This catches the
 * spec's headers (FROM, TIMESTAMP, RESPONSE, FILES CHANGED, ANGEL_MD_UPDATED,
 * DRIFT REPORT, etc.). The same regex is used everywhere — keep it that way.
 */
const NEXT_HEADER_LOOKAHEAD = /\n(?=[A-Z][A-Z_ ]*:)/;

/**
 * Escape a string for safe interpolation into a regex.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a single-line "FIELD: value" header. Throws if the field is
 * absent. The optional `source` is woven into the error message so callers
 * (e.g. cable parsing) can identify which file failed.
 */
export function extractRequiredField(
  raw: string,
  field: string,
  source?: string,
): string {
  const regex = new RegExp(`^${escapeRegex(field)}:\\s*(.+)$`, 'm');
  const match = raw.match(regex);
  if (!match) {
    const suffix = source ? ` in ${source}` : '';
    throw new Error(`Missing required field "${field}"${suffix}`);
  }
  return match[1].trim();
}

/**
 * Extract a single-line "FIELD: value" header, or null if absent.
 */
export function extractOptionalField(raw: string, field: string): string | null {
  const regex = new RegExp(`^${escapeRegex(field)}:\\s*(.+)$`, 'm');
  const match = raw.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract a multi-line section: starts at "SECTION:\n" and ends at the next
 * recognised header line (or end of file). Returns the trimmed body, or
 * null if the section header is missing OR the body is empty.
 */
export function extractSection(raw: string, sectionName: string): string | null {
  const headerRegex = new RegExp(`^${escapeRegex(sectionName)}:\\s*$`, 'm');
  const headerMatch = headerRegex.exec(raw);
  if (!headerMatch) {
    return null;
  }

  const startIndex = headerMatch.index + headerMatch[0].length;
  const remaining = raw.slice(startIndex);

  const nextHeaderMatch = remaining.match(NEXT_HEADER_LOOKAHEAD);
  const body = nextHeaderMatch
    ? remaining.slice(0, nextHeaderMatch.index)
    : remaining;

  const trimmed = body.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Convert an ISO-8601 timestamp to the filename-prefix shape used for
 * briefs, responses, and (eventually) cables: "2026-04-28T14:32:00Z" →
 * "2026-04-28T1432". Throws on malformed input.
 *
 * `kind` is woven into the error message so the user knows which subsystem
 * fed bad data.
 */
export function extractDatePrefix(isoTimestamp: string, kind: string): string {
  const match = isoTimestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    throw new Error(`Invalid ISO timestamp for ${kind} filename: "${isoTimestamp}"`);
  }
  const [, date, hours, minutes] = match;
  return `${date}T${hours}${minutes}`;
}

/**
 * Compute the next zero-padded sequence number for a same-day file in `dir`.
 * Filenames are expected to look like "<YYYY-MM-DD>T<HHMM>-<NNNN>.md" (briefs,
 * cables) or ".json" (responses); both extensions count toward the sequence.
 *
 * The sequence matcher is `(\d+)` (not a fixed width): a fixed `\d{3}` made
 * the 1000th same-day file invisible to the scanner, so `computeNextSeq`
 * kept returning "1000" and silently overwrote it. Padding is 4 digits for
 * lexicographic order up to 9999; legacy 3-digit names still parse.
 *
 * If `dir` doesn't exist or can't be read, the next seq is "0001".
 */
export function computeNextSeq(dir: string, datePrefix: string): string {
  const dateOnly = datePrefix.slice(0, 10);
  let maxSeq = 0;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    const match = entry.match(/^(\d{4}-\d{2}-\d{2})T\d{4}-(\d+)\.(?:md|json)$/);
    if (match && match[1] === dateOnly) {
      const seq = parseInt(match[2], 10);
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return String(maxSeq + 1).padStart(4, '0');
}
