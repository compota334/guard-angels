import { mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { angelResponsesDir } from '../paths/layout.js';

export type ResponseVerdict = 'proceed' | 'concerns' | 'refuse' | 'done' | 'error';

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'proceed',
  'concerns',
  'refuse',
  'done',
  'error',
]);

const DONE_ONLY_FIELDS = ['CABLES SENT', 'FILES CHANGED', 'ANGEL_MD_UPDATED'] as const;

export interface ResponseData {
  from: string;
  timestamp: string;
  response: ResponseVerdict;
  concerns: string;
  proposedPlan: string;
  questionsForMain: string;
  proceedIf: string;
  testResults: string;
  cablesSent: string;
  filesChanged: string;
  angelMdUpdated: string;
}

/**
 * Write a response file to _responses/<angel-id>/<date>T<time>-<seq>.md
 *
 * Sequence numbering: scans existing same-day files in the target dir
 * and picks max(seq)+1, zero-padded to 3 digits.
 *
 * Returns the full path of the written file.
 */
export function writeResponse(
  projectRoot: string,
  data: ResponseData,
): string {
  const dir = angelResponsesDir(projectRoot, data.from);
  mkdirSync(dir, { recursive: true });

  const datePrefix = extractDatePrefix(data.timestamp);
  const seq = computeNextSeq(dir, datePrefix);
  const filename = `${datePrefix}-${seq}.md`;
  const filePath = join(dir, filename);

  const content = formatResponse(data);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Parse a response file back into structured data.
 * Validates all required fields and throws on malformed input.
 */
export function parseResponse(filePath: string): ResponseData {
  const raw = readFileSync(filePath, 'utf-8');
  return parseResponseContent(raw);
}

/**
 * Parse response content from a string (useful for testing without files).
 */
export function parseResponseContent(raw: string): ResponseData {
  const from = extractRequiredField(raw, 'FROM');
  const timestamp = extractRequiredField(raw, 'TIMESTAMP');
  const response = extractRequiredField(raw, 'RESPONSE');

  if (!VALID_VERDICTS.has(response)) {
    throw new Error(
      `Invalid RESPONSE value: "${response}". Must be one of: proceed, concerns, refuse, done, error`,
    );
  }

  const verdict = response as ResponseVerdict;

  const concerns = extractSection(raw, 'CONCERNS') ?? '';
  const proposedPlan = extractSection(raw, 'PROPOSED PLAN') ?? '';
  const questionsForMain = extractSection(raw, 'QUESTIONS FOR MAIN') ?? '';
  const proceedIf = extractSection(raw, 'PROCEED IF') ?? '';
  const testResults = extractSection(raw, 'TEST_RESULTS') ?? '';

  const cablesSent = extractOptionalField(raw, 'CABLES SENT') ?? '';
  const filesChanged = extractOptionalField(raw, 'FILES CHANGED') ?? '';
  const angelMdUpdated = extractOptionalField(raw, 'ANGEL_MD_UPDATED') ?? '';

  // Validate done-only fields: they must not appear on non-done responses
  if (verdict !== 'done') {
    for (const field of DONE_ONLY_FIELDS) {
      const value = field === 'CABLES SENT' ? cablesSent
        : field === 'FILES CHANGED' ? filesChanged
        : angelMdUpdated;
      if (value !== '') {
        throw new Error(
          `Field "${field}" is only valid when RESPONSE is "done", but RESPONSE is "${verdict}"`,
        );
      }
    }
  }

  return {
    from,
    timestamp,
    response: verdict,
    concerns,
    proposedPlan,
    questionsForMain,
    proceedIf,
    testResults,
    cablesSent,
    filesChanged,
    angelMdUpdated,
  };
}

function formatResponse(data: ResponseData): string {
  const lines: string[] = [
    `FROM: ${data.from}`,
    `TIMESTAMP: ${data.timestamp}`,
    `RESPONSE: ${data.response}`,
    '',
    'CONCERNS:',
    data.concerns,
    '',
    'PROPOSED PLAN:',
    data.proposedPlan,
    '',
    'QUESTIONS FOR MAIN:',
    data.questionsForMain,
    '',
    'PROCEED IF:',
    data.proceedIf,
    '',
    'TEST_RESULTS:',
    data.testResults,
    '',
  ];

  if (data.response === 'done') {
    lines.push(`CABLES SENT: ${data.cablesSent}`);
    lines.push(`FILES CHANGED: ${data.filesChanged}`);
    lines.push(`ANGEL_MD_UPDATED: ${data.angelMdUpdated}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Extract a date prefix from an ISO timestamp for use in filenames.
 * Input: "2026-04-28T14:32:00Z" -> "2026-04-28T1432"
 */
function extractDatePrefix(isoTimestamp: string): string {
  const match = isoTimestamp.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/,
  );
  if (!match) {
    throw new Error(
      `Invalid ISO timestamp for response filename: "${isoTimestamp}"`,
    );
  }
  const [, date, hours, minutes] = match;
  return `${date}T${hours}${minutes}`;
}

/**
 * Extract the date-only part from a date prefix for same-day comparison.
 */
function extractDateOnly(prefix: string): string {
  return prefix.slice(0, 10);
}

/**
 * Compute the next sequence number for a given date prefix.
 */
function computeNextSeq(dir: string, datePrefix: string): string {
  const dateOnly = extractDateOnly(datePrefix);
  let maxSeq = 0;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    const match = entry.match(/^(\d{4}-\d{2}-\d{2})T\d{4}-(\d{3})\.md$/);
    if (match && match[1] === dateOnly) {
      const seq = parseInt(match[2], 10);
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return String(maxSeq + 1).padStart(3, '0');
}

/**
 * Extract a single-line header field value from the response content.
 * Expects format: "FIELD: value"
 */
function extractRequiredField(raw: string, field: string): string {
  const regex = new RegExp(`^${escapeRegex(field)}:\\s*(.+)$`, 'm');
  const match = raw.match(regex);
  if (!match) {
    throw new Error(`Missing required field: ${field}`);
  }
  return match[1].trim();
}

/**
 * Extract an optional single-line header field value.
 * Returns null if the field is not found.
 */
function extractOptionalField(raw: string, field: string): string | null {
  const regex = new RegExp(`^${escapeRegex(field)}:\\s*(.+)$`, 'm');
  const match = raw.match(regex);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

/**
 * Extract a multi-line section from the response content.
 * A section starts with "SECTION_NAME:" on its own line,
 * and ends at the next field/section header or end of string.
 */
function extractSection(raw: string, sectionName: string): string | null {
  const headerRegex = new RegExp(
    `^${escapeRegex(sectionName)}:\\s*$`,
    'm',
  );
  const headerMatch = headerRegex.exec(raw);
  if (!headerMatch) {
    return null;
  }

  const startIndex = headerMatch.index + headerMatch[0].length;
  const remaining = raw.slice(startIndex);

  // Find the next header (a line that starts with ALL-CAPS word(s) followed by colon)
  const nextHeaderMatch = remaining.match(/\n(?=[A-Z][A-Z_ ]*:)/);
  const body = nextHeaderMatch
    ? remaining.slice(0, nextHeaderMatch.index)
    : remaining;

  const trimmed = body.trim();
  return trimmed === '' ? null : trimmed;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
