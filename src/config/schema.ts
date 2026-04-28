import * as z from 'zod';

const AngelEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['root', 'folder']),
  path: z.string().min(1),
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
});

export type Config = z.infer<typeof ConfigSchema>;
export type AngelEntry = z.infer<typeof AngelEntrySchema>;
