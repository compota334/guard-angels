import * as z from 'zod';

export const MemoryConfigSchema = z.object({
  target_pct: z.number().min(1).max(100).optional().default(25),
  max_tokens: z.number().int().positive().optional(),
});

/**
 * A proof-of-done check: a shell command that must exit 0 for an EXECUTE in
 * this angel's territory to count as done. Run by the orchestrator, never by
 * the angel; output is captured as evidence.
 */
export const CheckSchema = z.object({
  name: z.string().min(1),
  cmd: z.string().min(1),
});

const AngelEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['root', 'folder']),
  path: z.string().min(1),
  memory: MemoryConfigSchema.optional(),
  checks: z.array(CheckSchema).optional(),
});

const BackendSchema = z.object({
  main_agent_cmd: z.string().min(1).optional(),
  angel_cmd: z.string().min(1),
  angel_timeout_seconds: z.number().int().positive(),
});

const SweepSchema = z.object({
  autonomy: z.enum(['report-only']),
});

const ExecuteConfigSchema = z.object({
  /** Block and roll back out-of-territory writes (true) or warn only (false). */
  strict_territory: z.boolean().optional().default(true),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
  backend: BackendSchema,
  angels: z.array(AngelEntrySchema).min(1),
  sweep: SweepSchema,
  global_notes: z.string().optional(),
  memory: MemoryConfigSchema.optional().default({ target_pct: 25 }),
  execute: ExecuteConfigSchema.optional().default({ strict_territory: true }),
  /** Per-check timeout for proof-of-done checks (seconds). */
  checks_timeout_seconds: z.number().int().positive().optional().default(300),
  newspaper: z
    .object({
      /** Rotate _newspaper.md into _archive/newspaper/ beyond this size. */
      max_bytes: z.number().int().positive().optional().default(5_242_880),
    })
    .optional()
    .default({ max_bytes: 5_242_880 }),
  housekeeping: z
    .object({
      /** Briefs/responses/logs older than this many days are archived by sweep. */
      archive_after_days: z.number().int().positive().optional().default(30),
    })
    .optional()
    .default({ archive_after_days: 30 }),
});

export type Config = z.infer<typeof ConfigSchema>;
/** Pre-validation shape: fields with schema defaults stay optional. */
export type ConfigInput = z.input<typeof ConfigSchema>;
export type AngelEntry = z.infer<typeof AngelEntrySchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type CheckEntry = z.infer<typeof CheckSchema>;
