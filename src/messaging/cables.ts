import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { angelInboxDir, angelOutboxDir } from '../paths/layout.js';
import {
  extractRequiredField,
  extractSection,
} from '../protocol/parser-utils.js';
import { appendNewspaper } from './newspaper.js';

export type CableType =
  | 'breaking_change'
  | 'fyi'
  | 'review_request'
  | 'invariant_violation';

export type CableUrgency = 'high' | 'normal' | 'low';

const VALID_TYPES: ReadonlySet<string> = new Set([
  'breaking_change',
  'fyi',
  'review_request',
  'invariant_violation',
]);

const VALID_URGENCIES: ReadonlySet<string> = new Set([
  'high',
  'normal',
  'low',
]);

export interface CableData {
  from: string;
  to: string;
  timestamp: string;
  type: CableType;
  urgency: CableUrgency;
  subject: string;
  requiresAck: boolean;
  body: string;
  references: string[];
}

/**
 * Write a cable to the outbox of the sender AND copy it to the inbox
 * of the recipient. The outbox write happens first; if the inbox copy
 * fails, the outbox entry is NOT rolled back (outbox is the audit trail).
 *
 * Returns the filename used for both files (identical content).
 */
export function writeCable(
  projectRoot: string,
  data: CableData,
): string {
  validateCableData(data);

  const formatted = formatCable(data);
  const filename = buildCableFilename(data);

  // 1. Write to outbox (audit trail — always persisted first)
  const outDir = angelOutboxDir(projectRoot, data.from);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, filename), formatted, 'utf-8');

  // 2. Copy to inbox of the recipient
  const inDir = angelInboxDir(projectRoot, data.to);
  mkdirSync(inDir, { recursive: true });
  writeFileSync(join(inDir, filename), formatted, 'utf-8');

  return filename;
}

/**
 * Read all pending cables from an angel's inbox, sorted by timestamp
 * ascending (oldest first).
 *
 * Returns an empty array if the inbox directory doesn't exist or is empty.
 */
export function readInbox(
  projectRoot: string,
  angelId: string,
): ParsedCable[] {
  const dir = angelInboxDir(projectRoot, angelId);

  let entries: string[];
  try {
    entries = readdirSync(dir);
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

  const cables: ParsedCable[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = join(dir, entry);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err: unknown) {
      throw new Error(`Failed to read cable file at ${filePath}`, { cause: err });
    }
    try {
      cables.push(parseCableContent(raw, filePath));
    } catch (err: unknown) {
      const quarantineDir = join(dir, '_quarantine');
      mkdirSync(quarantineDir, { recursive: true });
      renameSync(filePath, join(quarantineDir, entry));
      appendNewspaper(projectRoot, {
        timestamp: new Date().toISOString(),
        angelId,
        summary: `Malformed cable quarantined: ${entry}`,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sort by timestamp ascending
  cables.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return cables;
}

/**
 * A parsed cable with all structured fields.
 */
export interface ParsedCable {
  from: string;
  to: string;
  timestamp: string;
  type: CableType;
  urgency: CableUrgency;
  subject: string;
  requiresAck: boolean;
  body: string;
  references: string[];
  /** The raw file content for full-content rendering in prompts. */
  rawContent: string;
}

/**
 * Parse a cable file from disk.
 */
export function parseCable(filePath: string): ParsedCable {
  const raw = readFileSync(filePath, 'utf-8');
  return parseCableContent(raw, filePath);
}

/**
 * Parse cable content from a string (useful for testing without files).
 */
export function parseCableContent(
  raw: string,
  source: string = '<inline>',
): ParsedCable {
  const from = extractRequiredField(raw, 'FROM', source);
  const to = extractRequiredField(raw, 'TO', source);
  const timestamp = extractRequiredField(raw, 'TIMESTAMP', source);
  const typeStr = extractRequiredField(raw, 'TYPE', source);
  const urgencyStr = extractRequiredField(raw, 'URGENCY', source);
  const subject = extractRequiredField(raw, 'SUBJECT', source);
  const requiresAckStr = extractRequiredField(raw, 'REQUIRES_ACK', source);

  if (!VALID_TYPES.has(typeStr)) {
    throw new Error(
      `Invalid TYPE value in cable ${source}: "${typeStr}". Must be one of: ${[...VALID_TYPES].join(', ')}`,
    );
  }

  if (!VALID_URGENCIES.has(urgencyStr)) {
    throw new Error(
      `Invalid URGENCY value in cable ${source}: "${urgencyStr}". Must be one of: ${[...VALID_URGENCIES].join(', ')}`,
    );
  }

  const requiresAck = requiresAckStr === 'true';
  if (requiresAckStr !== 'true' && requiresAckStr !== 'false') {
    throw new Error(
      `Invalid REQUIRES_ACK value in cable ${source}: "${requiresAckStr}". Must be "true" or "false"`,
    );
  }

  const body = extractSection(raw, 'BODY') ?? '';
  const referencesRaw = extractSection(raw, 'REFERENCES') ?? '';
  const references = referencesRaw
    ? referencesRaw
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter((line) => line.length > 0)
    : [];

  return {
    from,
    to,
    timestamp,
    type: typeStr as CableType,
    urgency: urgencyStr as CableUrgency,
    subject,
    requiresAck,
    body,
    references,
    rawContent: raw,
  };
}

/**
 * Move all processed cable files from an angel's inbox to its outbox.
 * Called after the angel has seen the cables (via sweep or execute) so they
 * won't be re-delivered on the next invocation.
 * Quarantined cables (already moved by readInbox) are not touched.
 */
export function archiveProcessedInbox(projectRoot: string, angelId: string): void {
  const inboxPath = angelInboxDir(projectRoot, angelId);
  const outboxPath = angelOutboxDir(projectRoot, angelId);

  let entries: string[];
  try {
    entries = readdirSync(inboxPath);
  } catch {
    return;
  }

  const cableFiles = entries.filter((e) => e.endsWith('.md'));
  if (cableFiles.length === 0) return;

  mkdirSync(outboxPath, { recursive: true });
  for (const filename of cableFiles) {
    renameSync(join(inboxPath, filename), join(outboxPath, filename));
  }
}

// ── Internal helpers ──────────────────────────────────────────────────

function validateCableData(data: CableData): void {
  if (!data.from) throw new Error('Cable FROM is required');
  if (!data.to) throw new Error('Cable TO is required');
  if (!data.timestamp) throw new Error('Cable TIMESTAMP is required');
  if (!data.subject) throw new Error('Cable SUBJECT is required');

  if (!VALID_TYPES.has(data.type)) {
    throw new Error(
      `Invalid cable TYPE: "${data.type}". Must be one of: ${[...VALID_TYPES].join(', ')}`,
    );
  }
  if (!VALID_URGENCIES.has(data.urgency)) {
    throw new Error(
      `Invalid cable URGENCY: "${data.urgency}". Must be one of: ${[...VALID_URGENCIES].join(', ')}`,
    );
  }
}

function formatCable(data: CableData): string {
  const lines: string[] = [
    `FROM: ${data.from}`,
    `TO: ${data.to}`,
    `TIMESTAMP: ${data.timestamp}`,
    `TYPE: ${data.type}`,
    `URGENCY: ${data.urgency}`,
    `SUBJECT: ${data.subject}`,
    `REQUIRES_ACK: ${data.requiresAck}`,
    '',
    'BODY:',
    data.body,
    '',
    'REFERENCES:',
  ];

  if (data.references.length > 0) {
    for (const ref of data.references) {
      lines.push(`- ${ref}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Build a cable filename from the data. Format:
 * <iso-timestamp-sanitized>-cable-from-<from>.md
 *
 * Timestamps are sanitized: colons → dashes, to avoid filesystem issues.
 */
function buildCableFilename(data: CableData): string {
  // Sanitize timestamp for filename: replace colons with dashes
  const sanitizedTs = data.timestamp.replace(/:/g, '-');
  // Build a short slug from the sender id
  const fromSlug = data.from.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${sanitizedTs}-cable-from-${fromSlug}.md`;
}

