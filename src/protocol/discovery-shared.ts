/**
 * Filters shared by the discovery pipelines (discovery.ts and
 * discovery-enhanced.ts): scaffold directories to skip entirely and
 * binary file extensions to never read.
 */

export const SCAFFOLD_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '__pycache__', '.git', '.venv', 'venv', 'env',
  'dist', 'build', 'target', '.next', '.nuxt', 'out',
  'coverage', '.mypy_cache', '.pytest_cache', '.tox', '.eggs',
]);

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pyc', '.pyo', '.pyd',
  '.so', '.dylib', '.dll', '.exe', '.bin', '.o', '.a',
  '.jpg', '.jpeg', '.png', '.gif', '.ico', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.zip', '.tar', '.gz', '.bz2', '.xz',
  '.db', '.sqlite', '.sqlite3',
  '.pdf',
]);

export function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && BINARY_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export function pathHasScaffoldDir(rel: string): boolean {
  return rel.split('/').some((seg) => SCAFFOLD_DIRS.has(seg));
}
