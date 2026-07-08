import * as z from 'zod';

/**
 * JSON response contract between angels and the orchestrator (v0.3.0+).
 *
 * Angels write a single JSON object to the response path given in their
 * prompt. The orchestrator validates it against this schema and fails loudly
 * on any deviation; there is no markdown fallback.
 *
 * Field naming is snake_case on disk (what angels write); the internal
 * camelCase `ResponseData` shape lives in `response.ts`.
 */

export const RESPONSE_FORMAT_VERSION = 1;

export const ResponseVerdictSchema = z.enum([
  'proceed',
  'concerns',
  'refuse',
  'done',
  'error',
]);

export const WriteModeSchema = z.enum([
  'proposed',
  'direct',
  'chunk',
  'chunk_final',
]);

/**
 * A cable the angel reports having sent during EXECUTE/SWEEP.
 * This is a report for the audit trail; the cable file itself is validated
 * separately when the recipient's inbox is read.
 */
export const CableSentSchema = z
  .object({
    to: z.string().min(1),
    type: z.string().min(1),
  })
  .strict();

export const ResponseJsonSchema = z
  .object({
    format_version: z.literal(RESPONSE_FORMAT_VERSION),
    from: z.string().min(1),
    timestamp: z.string().min(1),
    verdict: ResponseVerdictSchema,
    write_mode: WriteModeSchema.default('proposed'),
    concerns: z.string().default(''),
    proposed_plan: z.string().default(''),
    questions_for_main: z.string().default(''),
    proceed_if: z.string().default(''),
    test_results: z.string().default(''),
    drift_report: z.string().default(''),
    cables_sent: z.array(CableSentSchema).default([]),
    files_changed: z.array(z.string().min(1)).default([]),
    angel_md_updated: z.boolean().default(false),
  })
  .strict();

export type ResponseJson = z.infer<typeof ResponseJsonSchema>;
export type CableSent = z.infer<typeof CableSentSchema>;

/**
 * Format a Zod error into a message that names every offending field;
 * this string ends up in the OrchestrationError the user sees.
 */
export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
