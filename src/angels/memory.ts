import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as z from 'zod';

export const AngelFrontmatterSchema = z.object({
  status: z.enum(['draft', 'active']),
  last_updated: z.string().min(1),
  last_updated_by: z.enum(['main', 'sweep', 'self']),
  notes: z.string().optional(),
  // NEW: memory metadata
  memory_target_pct: z.coerce.number().optional(),
  memory_max_tokens: z.coerce.number().optional(),
  territory_size: z.coerce.number().optional(),
  code_coverage_pct: z.coerce.number().optional(),
});

export type AngelFrontmatter = z.infer<typeof AngelFrontmatterSchema>;

export interface AngelMd {
  frontmatter: AngelFrontmatter;
  body: string;
  /** Raw file content as read from disk. Only set by readAngelMd; absent on objects constructed for writing. */
  raw?: string;
}

const FRONTMATTER_OPEN = '---\n';
const FRONTMATTER_CLOSE = '\n---\n';

function parseFrontmatterYaml(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`Invalid frontmatter line (no colon): "${trimmed}"`);
    }
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function serializeFrontmatter(fm: AngelFrontmatter): string {
  const lines = [
    `status: ${fm.status}`,
    `last_updated: ${fm.last_updated}`,
    `last_updated_by: ${fm.last_updated_by}`,
  ];
  if (fm.notes !== undefined) {
    lines.push(`notes: ${fm.notes}`);
  }
  if (fm.memory_target_pct !== undefined) {
    lines.push(`memory_target_pct: ${fm.memory_target_pct}`);
  }
  if (fm.memory_max_tokens !== undefined) {
    lines.push(`memory_max_tokens: ${fm.memory_max_tokens}`);
  }
  if (fm.territory_size !== undefined) {
    lines.push(`territory_size: ${fm.territory_size}`);
  }
  if (fm.code_coverage_pct !== undefined) {
    lines.push(`code_coverage_pct: ${fm.code_coverage_pct}`);
  }
  return lines.join('\n');
}

export function readAngelMd(filePath: string): AngelMd {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    throw new Error(`Cannot read angel.md at ${filePath}: ${(err as Error).message}`, {
      cause: err,
    });
  }

  if (!raw.startsWith('---\n')) {
    throw new Error(
      `Missing YAML frontmatter in ${filePath}: file must start with "---"`,
    );
  }

  const closeIdx = raw.indexOf('\n---', 4);
  if (closeIdx === -1) {
    throw new Error(
      `Malformed YAML frontmatter in ${filePath}: missing closing "---"`,
    );
  }

  const frontmatterBlock = raw.slice(FRONTMATTER_OPEN.length, closeIdx);
  const parsed = parseFrontmatterYaml(frontmatterBlock);

  const validated = AngelFrontmatterSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter in ${filePath}: ${issues}`);
  }

  // Body starts after the closing "---\n"
  const bodyStart = closeIdx + '\n---\n'.length;
  const body = bodyStart < raw.length ? raw.slice(bodyStart) : '';

  return {
    frontmatter: validated.data,
    body,
    raw,
  };
}

export function writeAngelMd(filePath: string, angelMd: AngelMd): void {
  // Validate frontmatter before writing
  const validated = AngelFrontmatterSchema.safeParse(angelMd.frontmatter);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter for write: ${issues}`);
  }

  const content =
    FRONTMATTER_OPEN +
    serializeFrontmatter(validated.data) +
    FRONTMATTER_CLOSE +
    angelMd.body;

  // Atomic write: write to tmpfile in the same directory, then rename
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.angel.md.tmp.${crypto.randomBytes(6).toString('hex')}`);

  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err: unknown) {
    // Clean up tmpfile on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(`Failed to write angel.md at ${filePath}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

export function updateMetadata(
  filePath: string,
  partial: Partial<AngelFrontmatter>,
): void {
  const current = readAngelMd(filePath);
  const updated: AngelFrontmatter = {
    ...current.frontmatter,
    ...partial,
  };
  writeAngelMd(filePath, { frontmatter: updated, body: current.body });
}
