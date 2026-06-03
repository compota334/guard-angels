import * as z from 'zod';

export const MemoryConfigSchema = z.object({
  target_pct: z.number().min(1).max(100).optional().default(25),
  max_tokens: z.number().int().positive().optional(),
});

const AngelEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['root', 'folder']),
  path: z.string().min(1),
  memory: MemoryConfigSchema.optional(),
});

const BackendSchema = z.object({
  main_agent_cmd: z.string().min(1).optional(),
  angel_cmd: z.string().min(1),
  angel_timeout_seconds: z.number().int().positive(),
});

const SweepSchema = z.object({
  autonomy: z.enum(['report-only']),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
  backend: BackendSchema,
  angels: z.array(AngelEntrySchema).min(1),
  sweep: SweepSchema,
  global_notes: z.string().optional(),
  memory: MemoryConfigSchema.optional().default({ target_pct: 25 }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AngelEntry = z.infer<typeof AngelEntrySchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
