import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { angelResponsesDir } from '../paths/layout.js';
import {
  extractRequiredField,
  extractOptionalField,
  extractSection,
  extractDatePrefix,
  computeNextSeq,
} from './parser-utils.js';

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
  driftReport: string;
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

  const datePrefix = extractDatePrefix(data.timestamp, 'response');
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
  const driftReport = extractSection(raw, 'DRIFT REPORT') ?? '';

  const cablesSent = extractOptionalField(raw, 'CABLES SENT') ?? '';
  const filesChanged = extractOptionalField(raw, 'FILES CHANGED') ?? '';
  const angelMdUpdated = extractOptionalField(raw, 'ANGEL_MD_UPDATED') ?? '';

  // Validate contextual invariants
  if (verdict === 'concerns' && proposedPlan.trim() === '') {
    throw new Error(
      'RESPONSE is "concerns" but PROPOSED PLAN is empty. ' +
      'An angel that raises concerns must include a proposed plan. ' +
      'This is almost certainly a bug in the angel response.',
    );
  }

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
    driftReport,
    cablesSent,
    filesChanged,
    angelMdUpdated,
  };
}

export function formatResponse(data: ResponseData): string {
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
    'DRIFT REPORT:',
    data.driftReport,
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

