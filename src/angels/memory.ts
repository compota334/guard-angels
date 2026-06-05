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

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  sizeBytes: number;
  frontmatter: Record<string, unknown> | null;
  bodyLength: number;
}

export interface AppendResult {
  previousSizeBytes: number;
  newSizeBytes: number;
  appendedChars: number;
}

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

/**
 * Append a body chunk to an existing angel.md file.
 *
 * Reads the existing angel.md, extracts the YAML frontmatter, appends the
 * bodyChunk at the end of the current body (after the frontmatter, before
 * EOF), updates last_updated in the frontmatter, and writes the file back.
 *
 * Also creates an automatic backup of the previous state in:
 *   .angels/_backups/<relative-angel-path>/<timestamp>.md
 *
 * Throws if the angel.md is missing/malformed or the write fails — there is
 * no silent failure path, so callers must let the error propagate or handle
 * it explicitly.
 *
 * @param angelPath - Relative angel path (e.g. "src/auth" or "." for root)
 * @param bodyChunk - The markdown body chunk to append
 * @returns AppendResult with sizes before/after the operation
 */
export function appendAngelMd(angelPath: string, bodyChunk: string): AppendResult {
  const filePath = getAngelMdPath(angelPath);

  // Read existing file (throws if missing or malformed)
  const existing = readAngelMd(filePath);
  const previousSizeBytes = existing.raw?.length ?? 0;

  // Create backup before modifying
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(
    path.dirname(filePath),
    '..',
    '_backups',
    angelPath === '.' ? '_root' : angelPath,
  );
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${timestamp}.md`);
  if (existing.raw) {
    fs.writeFileSync(backupPath, existing.raw, 'utf-8');
  }

  // Append bodyChunk to existing body
  const newBody = existing.body + '\n' + bodyChunk;

  // Update frontmatter with fresh timestamp
  const updatedFrontmatter: AngelFrontmatter = {
    ...existing.frontmatter,
    last_updated: new Date().toISOString(),
    last_updated_by: 'main',
  };

  // Write the complete file (throws on failure)
  writeAngelMd(filePath, {
    frontmatter: updatedFrontmatter,
    body: newBody,
  });

  const newSizeBytes = fs.statSync(filePath).size;

  return {
    previousSizeBytes,
    newSizeBytes,
    appendedChars: bodyChunk.length,
  };
}

/**
 * Return the standard angel.md path for a given angel path.
 * E.g. getAngelMdPath('src/auth') → '.angels/src/auth/angel.md'
 */
export function getAngelMdPath(angelPath: string): string {
  return `.angels/${angelPath}/angel.md`;
}

/**
 * Verify that an angel.md file at the given path exists and is well-formed.
 *
 * Checks:
 * - File exists
 * - Has valid YAML frontmatter (readAngelMd validates this)
 * - Has last_updated in frontmatter
 * - Body is not empty (> 50 characters)
 * - Optionally: body tokens >= expectedMinTokens (chars * 0.75 >= expectedMinTokens)
 *
 * @param path - Absolute path to angel.md
 * @param expectedMinTokens - If provided, verify body has at least this many tokens
 * @returns Verification result with valid flag, errors array, file size, parsed frontmatter, and body length
 */
export function verifyAngelMd(filePath: string, expectedMinTokens?: number): VerificationResult {
  const errors: string[] = [];

  // 1. File exists
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: ['File does not exist'], sizeBytes: 0, frontmatter: null, bodyLength: 0 };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { valid: false, errors: ['Cannot stat file'], sizeBytes: 0, frontmatter: null, bodyLength: 0 };
  }

  const sizeBytes = stat.size;

  // 2-3. Parse and validate frontmatter (readAngelMd throws on malformed)
  let angelMd: AngelMd;
  try {
    angelMd = readAngelMd(filePath);
  } catch (err: unknown) {
    errors.push(`Invalid frontmatter: ${(err as Error).message}`);
    return { valid: false, errors, sizeBytes, frontmatter: null, bodyLength: 0 };
  }

  // 4. Body should not be empty (> 50 characters)
  const bodyLength = angelMd.body.trim().length;
  if (bodyLength < 50) {
    errors.push(`Body too short: ${bodyLength} characters, expected at least 50`);
  }

  // 5. last_updated present in frontmatter
  if (!angelMd.frontmatter.last_updated) {
    errors.push('Missing last_updated in frontmatter');
  }

  // 6. Optional: check minimum token count (conservative chars→tokens ratio 0.75)
  if (expectedMinTokens !== undefined) {
    const estimatedTokens = Math.floor(bodyLength * 0.75);
    if (estimatedTokens < expectedMinTokens) {
      errors.push(
        `Body too small: ~${estimatedTokens} estimated tokens (${bodyLength} chars * 0.75), ` +
          `expected at least ${expectedMinTokens} tokens`,
      );
    }
  }

  // Build raw frontmatter dict for the result
  const frontmatter: Record<string, unknown> = { ...angelMd.frontmatter };

  return {
    valid: errors.length === 0,
    errors,
    sizeBytes,
    frontmatter,
    bodyLength,
  };
}
