const ROOT_ANGEL_ID = '_root';
const ROOT_ANGEL_PATH = '.';

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
  // Replace `--` with a placeholder, then `-` with `/`, then restore `--` as `-`
  const PLACEHOLDER = '\x00';
  return id
    .replaceAll('--', PLACEHOLDER)
    .replaceAll('-', '/')
    .replaceAll(PLACEHOLDER, '-');
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
