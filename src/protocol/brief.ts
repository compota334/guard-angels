import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { angelBriefsDir } from '../paths/layout.js';
import {
  extractRequiredField,
  extractSection,
  extractDatePrefix,
  computeNextSeq,
} from './parser-utils.js';

export type BriefPhase = 'review' | 'execute' | 'sweep' | 'discovery' | 'ask';
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

  const datePrefix = extractDatePrefix(data.timestamp, 'brief');
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

  if (phase !== 'review' && phase !== 'execute' && phase !== 'sweep' && phase !== 'discovery' && phase !== 'ask') {
    throw new Error(`Invalid PHASE value: "${phase}". Must be "review", "execute", "sweep", "discovery", or "ask"`);
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

