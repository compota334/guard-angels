import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import { angelResponsesDir } from '../paths/layout.js';
import { extractDatePrefix, computeNextSeq } from './parser-utils.js';
import {
  RESPONSE_FORMAT_VERSION,
  ResponseJsonSchema,
  formatSchemaIssues,
  type CableSent,
  type ResponseJson,
} from './response-schema.js';

export type WriteMode = 'proposed' | 'direct' | 'chunk' | 'chunk_final';

export type ResponseVerdict = 'proceed' | 'concerns' | 'refuse' | 'done' | 'error';

export type { CableSent } from './response-schema.js';

/**
 * Internal camelCase view of an angel response. The on-disk format is the
 * snake_case JSON defined in `response-schema.ts`.
 */
export interface ResponseData {
  from: string;
  timestamp: string;
  response: ResponseVerdict;
  writeMode: WriteMode;
  concerns: string;
  proposedPlan: string;
  questionsForMain: string;
  proceedIf: string;
  testResults: string;
  driftReport: string;
  cablesSent: CableSent[];
  filesChanged: string[];
  angelMdUpdated: boolean;
}

/**
 * Write a response file to _responses/<angel-id>/<date>T<time>-<seq>.json
 *
 * Sequence numbering: scans existing same-day files in the target dir
 * and picks max(seq)+1, zero-padded.
 *
 * Production responses are written by the angels themselves; this helper is
 * used by tests and tooling that need to fabricate a valid response file.
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
  const filename = `${datePrefix}-${seq}.json`;
  const filePath = join(dir, filename);

  writeFileSync(filePath, formatResponse(data), 'utf-8');
  return filePath;
}

/**
 * Serialize a ResponseData into the canonical on-disk JSON document.
 */
export function formatResponse(data: ResponseData): string {
  const json: ResponseJson = {
    format_version: RESPONSE_FORMAT_VERSION,
    from: data.from,
    timestamp: data.timestamp,
    verdict: data.response,
    write_mode: data.writeMode,
    concerns: data.concerns,
    proposed_plan: data.proposedPlan,
    questions_for_main: data.questionsForMain,
    proceed_if: data.proceedIf,
    test_results: data.testResults,
    drift_report: data.driftReport,
    cables_sent: data.cablesSent,
    files_changed: data.filesChanged,
    angel_md_updated: data.angelMdUpdated,
  };
  return JSON.stringify(json, null, 2) + '\n';
}

/**
 * Parse a response file back into structured data.
 * Validates the JSON document and throws on malformed input.
 */
export function parseResponse(filePath: string): ResponseData {
  const raw = readFileSync(filePath, 'utf-8');
  return parseResponseContent(raw);
}

/**
 * Parse response content from a string (useful for testing without files).
 *
 * Fail-loud contract: any deviation from the schema throws with a message
 * naming the offending field. There is no fallback format.
 */
export function parseResponseContent(raw: string): ResponseData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(
      `Response file is not valid JSON: ${(err as Error).message}. ` +
        `Angels must write a single JSON object matching the response schema ` +
        `(format_version ${RESPONSE_FORMAT_VERSION}).`,
      { cause: err },
    );
  }

  const result = ResponseJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Response JSON does not match the schema: ${formatSchemaIssues(result.error)}`,
    );
  }

  return validateCrossFieldRules(result.data);
}

/**
 * Contextual invariants that the flat schema cannot express.
 */
function validateCrossFieldRules(json: ResponseJson): ResponseData {
  if (json.verdict === 'concerns' && json.proposed_plan.trim() === '') {
    throw new Error(
      'verdict is "concerns" but proposed_plan is empty. ' +
        'An angel that raises concerns must include a proposed plan. ' +
        'This is almost certainly a bug in the angel response.',
    );
  }

  if (json.verdict !== 'done') {
    if (json.cables_sent.length > 0) {
      throw new Error(
        `cables_sent is only valid when verdict is "done", but verdict is "${json.verdict}"`,
      );
    }
    if (json.files_changed.length > 0) {
      throw new Error(
        `files_changed is only valid when verdict is "done", but verdict is "${json.verdict}"`,
      );
    }
    if (json.angel_md_updated) {
      throw new Error(
        `angel_md_updated is only valid when verdict is "done", but verdict is "${json.verdict}"`,
      );
    }
  }

  return {
    from: json.from,
    timestamp: json.timestamp,
    response: json.verdict,
    writeMode: json.write_mode,
    concerns: json.concerns,
    proposedPlan: json.proposed_plan,
    questionsForMain: json.questions_for_main,
    proceedIf: json.proceed_if,
    testResults: json.test_results,
    driftReport: json.drift_report,
    cablesSent: json.cables_sent,
    filesChanged: json.files_changed,
    angelMdUpdated: json.angel_md_updated,
  };
}

// Re-exported so error messages elsewhere can reference the same constant.
export { RESPONSE_FORMAT_VERSION } from './response-schema.js';

// Narrow re-export used by callers that only need to know the Zod error type.
export type ResponseSchemaError = z.ZodError;
