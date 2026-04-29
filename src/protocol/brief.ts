import { mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { angelBriefsDir } from '../paths/layout.js';

export type BriefPhase = 'review' | 'execute' | 'sweep';
export type BriefType = 'change_request' | 'consultation' | 'sweep';

export interface BriefData {
  to: string;
  from: string;
  timestamp: string;
  phase: BriefPhase;
  type: BriefType;
  task: string;
  context: string;
  expectedScope: string;
  priorResponse: string;
}

/**
 * Write a brief file to _briefs/<angel-id>/<date>T<time>-<seq>.md
 *
 * Sequence numbering: scans existing same-day files in the target dir
 * and picks max(seq)+1, zero-padded to 3 digits.
 *
 * Returns the full path of the written file.
 */
export function writeBrief(
  projectRoot: string,
  data: BriefData,
): string {
  const dir = angelBriefsDir(projectRoot, data.to);
  mkdirSync(dir, { recursive: true });

  const datePrefix = extractDatePrefix(data.timestamp);
  const seq = computeNextSeq(dir, datePrefix);
  const filename = `${datePrefix}-${seq}.md`;
  const filePath = join(dir, filename);

  const content = formatBrief(data);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Parse a brief file back into structured data.
 * Validates all required fields and throws on malformed input.
 */
export function parseBrief(filePath: string): BriefData {
  const raw = readFileSync(filePath, 'utf-8');
  return parseBriefContent(raw);
}

/**
 * Parse brief content from a string (useful for testing without files).
 */
export function parseBriefContent(raw: string): BriefData {
  const to = extractRequiredField(raw, 'TO');
  const from = extractRequiredField(raw, 'FROM');
  const timestamp = extractRequiredField(raw, 'TIMESTAMP');
  const phase = extractRequiredField(raw, 'PHASE');
  const type = extractRequiredField(raw, 'TYPE');
  const priorResponse = extractRequiredField(raw, 'PRIOR RESPONSE');

  if (phase !== 'review' && phase !== 'execute' && phase !== 'sweep') {
    throw new Error(`Invalid PHASE value: "${phase}". Must be "review", "execute", or "sweep"`);
  }

  if (type !== 'change_request' && type !== 'consultation' && type !== 'sweep') {
    throw new Error(`Invalid TYPE value: "${type}". Must be "change_request", "consultation", or "sweep"`);
  }

  const task = extractSection(raw, 'TASK');
  if (!task) {
    throw new Error('Missing required section: TASK');
  }

  const context = extractSection(raw, 'CONTEXT') ?? '';
  const expectedScope = extractSection(raw, 'EXPECTED SCOPE') ?? '';

  return {
    to,
    from,
    timestamp,
    phase,
    type,
    task,
    context,
    expectedScope,
    priorResponse,
  };
}

function formatBrief(data: BriefData): string {
  const lines: string[] = [
    `TO: ${data.to}`,
    `FROM: ${data.from}`,
    `TIMESTAMP: ${data.timestamp}`,
    `PHASE: ${data.phase}`,
    `TYPE: ${data.type}`,
    '',
    'TASK:',
    data.task,
    '',
    'CONTEXT:',
    data.context,
    '',
    'EXPECTED SCOPE:',
    data.expectedScope,
    '',
    `PRIOR RESPONSE: ${data.priorResponse}`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Extract a date prefix from an ISO timestamp for use in filenames.
 * Input: "2026-04-28T14:32:00Z" -> "2026-04-28T1432"
 */
function extractDatePrefix(isoTimestamp: string): string {
  // Parse the ISO timestamp to get date and time components
  const match = isoTimestamp.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/,
  );
  if (!match) {
    throw new Error(
      `Invalid ISO timestamp for brief filename: "${isoTimestamp}"`,
    );
  }
  const [, date, hours, minutes] = match;
  return `${date}T${hours}${minutes}`;
}

/**
 * Extract the date-only part from a date prefix for same-day comparison.
 * "2026-04-28T1432" -> "2026-04-28"
 */
function extractDateOnly(prefix: string): string {
  return prefix.slice(0, 10);
}

/**
 * Compute the next sequence number for a given date prefix.
 * Scans existing files in the directory and returns max(seq)+1 zero-padded.
 */
function computeNextSeq(dir: string, datePrefix: string): string {
  const dateOnly = extractDateOnly(datePrefix);
  let maxSeq = 0;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory might be freshly created and empty
    entries = [];
  }

  for (const entry of entries) {
    // Match files like "2026-04-28T1432-001.md"
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
 * Extract a single-line header field value from the brief content.
 * Expects format: "FIELD: value"
 */
function extractRequiredField(raw: string, field: string): string {
  // Match the field at the start of a line
  const regex = new RegExp(`^${escapeRegex(field)}:\\s*(.+)$`, 'm');
  const match = raw.match(regex);
  if (!match) {
    throw new Error(`Missing required field: ${field}`);
  }
  return match[1].trim();
}

/**
 * Extract a multi-line section from the brief content.
 * A section starts with "SECTION_NAME:" on its own line,
 * and ends at the next field/section header or end of string.
 *
 * Returns the trimmed body content, or null if the section is empty.
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
  const nextHeaderMatch = remaining.match(/\n(?=[A-Z][A-Z _]*:)/);
  const body = nextHeaderMatch
    ? remaining.slice(0, nextHeaderMatch.index)
    : remaining;

  const trimmed = body.trim();
  return trimmed === '' ? null : trimmed;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
