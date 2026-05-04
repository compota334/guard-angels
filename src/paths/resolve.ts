import { resolve as resolvePath } from 'node:path';

const ROOT_ANGEL_ID = '_root';
const ROOT_ANGEL_PATH = '.';

// Sentinel used to verify decoded paths cannot escape the project root.
// We resolve decoded IDs relative to this absolute path and confirm the
// result still lives under it — catching any .. traversal attempts.
const SAFE_ROOT = '/safe_root_sentinel';

/**
 * Convert an angel ID to the folder path it represents.
 *
 * Encoding scheme:
 * - Single `-` represents a `/` (path separator)
 * - Double `--` represents a literal `-` in a segment name
 * - `_root` is the special root angel ID mapping to `.`
 *
 * Examples:
 * - `_root` → `.`
 * - `src-auth` → `src/auth`
 * - `src-my--component` → `src/my-component`
 */
export function angelIdToPath(id: string): string {
  validateAngelId(id);
  if (id === ROOT_ANGEL_ID) {
    return ROOT_ANGEL_PATH;
  }
  // Character-by-character parse: `--` = literal `-`, single `-` = `/`
  let result = '';
  let i = 0;
  while (i < id.length) {
    if (id[i] === '-' && i + 1 < id.length && id[i + 1] === '-') {
      result += '-';
      i += 2;
    } else if (id[i] === '-') {
      result += '/';
      i += 1;
    } else {
      result += id[i];
      i += 1;
    }
  }
  // Reject any decoded path that contains ".." segments
  if (result.split('/').some((seg) => seg === '..')) {
    throw new Error(
      `Angel ID "${id}" decodes to a path with ".." segments: "${result}"`,
    );
  }
  // Resolve against a sentinel root and verify the result stays within it
  const resolved = resolvePath(SAFE_ROOT, result);
  if (resolved !== SAFE_ROOT && !resolved.startsWith(SAFE_ROOT + '/')) {
    throw new Error(
      `Angel ID "${id}" decodes to a path that escapes the project root: "${result}"`,
    );
  }
  return result;
}

/**
 * Convert a folder path to its angel ID.
 *
 * Encoding scheme:
 * - `/` becomes `-`
 * - Literal `-` in segment names becomes `--`
 * - `.` maps to `_root`
 *
 * Examples:
 * - `.` → `_root`
 * - `src/auth` → `src-auth`
 * - `src/my-component` → `src-my--component`
 */
export function pathToAngelId(path: string): string {
  validatePath(path);
  const normalized = normalizePath(path);
  if (normalized === ROOT_ANGEL_PATH) {
    return ROOT_ANGEL_ID;
  }
  // Validate that no segment consists entirely of hyphens (cannot round-trip)
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (/^-+$/.test(segment)) {
      throw new Error(
        `Path segment "${segment}" consists entirely of hyphens and cannot be encoded as an angel ID`,
      );
    }
  }
  // First escape existing hyphens in segment names, then replace slashes
  return normalized
    .replaceAll('-', '--')
    .replaceAll('/', '-');
}

/**
 * Check whether an angel ID refers to the root angel.
 */
export function isRootAngel(id: string): boolean {
  return id === ROOT_ANGEL_ID;
}

function normalizePath(path: string): string {
  // Strip leading/trailing slashes and collapse duplicates
  const normalized = path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  if (normalized === '' || normalized === '.') {
    return ROOT_ANGEL_PATH;
  }
  return normalized;
}

function validateAngelId(id: string): void {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('Angel ID must be a non-empty string');
  }
  if (id.includes('/')) {
    throw new Error(`Angel ID must not contain slashes: "${id}"`);
  }
}

function validatePath(path: string): void {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('Path must be a non-empty string');
  }
}
