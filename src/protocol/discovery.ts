import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface DiscoveryContext {
  fileListing: string;
  priorityFiles: Record<string, string>;
}

const MAX_PRIORITY_CHARS = 51200; // 50 KB total across all priority files
const MAX_FILE_SNIPPET_CHARS = 5120; // 5 KB per individual file

const PRIORITY_PATTERNS: RegExp[] = [
  /^README\./i,
  /^(index|main|mod|__init__)\./i,
  /\.d\.ts$|^(types|interfaces|schema)\./i,
  /\.(test|spec)\./i,
  /^(package\.json|tsconfig\.json|pyproject\.toml)$/i,
];

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pyc', '.pyo', '.pyd',
  '.so', '.dylib', '.dll', '.exe', '.bin', '.o', '.a',
  '.jpg', '.jpeg', '.png', '.gif', '.ico', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.zip', '.tar', '.gz', '.bz2', '.xz',
  '.db', '.sqlite', '.sqlite3',
  '.pdf',
]);

const SCAFFOLD_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '__pycache__', '.git', '.venv', 'venv', 'env',
  'dist', 'build', 'target', '.next', '.nuxt', 'out',
  'coverage', '.mypy_cache', '.pytest_cache', '.tox', '.eggs',
]);

function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && BINARY_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function pathHasScaffoldDir(rel: string): boolean {
  return rel.split('/').some(seg => SCAFFOLD_DIRS.has(seg));
}

export function buildRecursiveListing(
  territoryPath: string,
  depth: number,
  maxLines: number = 500,
): string {
  if (!existsSync(territoryPath)) return '## Territory Listing\n(empty)\n';
  const all = readdirSync(territoryPath, { recursive: true, withFileTypes: true });
  const lines: string[] = ['## Territory Listing'];
  for (const entry of all) {
    const rel = relative(territoryPath, join(entry.parentPath ?? territoryPath, entry.name));
    if (pathHasScaffoldDir(rel)) continue;
    const slashCount = (rel.match(/\//g) ?? []).length;
    if (slashCount >= depth) continue;
    const line = entry.isDirectory() ? `${rel}/` : rel;
    lines.push(line);
    if (lines.length > maxLines) {
      lines.push('... (truncated)');
      break;
    }
  }
  return lines.join('\n');
}

export function buildDiscoveryContext(
  territoryPath: string,
  depth: number = 3,
): DiscoveryContext {
  const fileListing = buildRecursiveListing(territoryPath, depth);
  const priorityFiles: Record<string, string> = {};
  const all = readdirSync(territoryPath, { recursive: true, withFileTypes: true });
  let count = 0;
  let totalChars = 0;
  outer: for (const pattern of PRIORITY_PATTERNS) {
    for (const entry of all) {
      if (entry.isDirectory()) continue;
      const name = entry.name;
      if (isBinaryFile(name)) continue;
      if (!pattern.test(name)) continue;
      const full = join(entry.parentPath ?? territoryPath, name);
      if (pathHasScaffoldDir(relative(territoryPath, full))) continue;
      try {
        const content = readFileSync(full, 'utf-8');
        if (content.includes('\0')) continue;
        const raw = content.split('\n').slice(0, 200).join('\n');
        const snippet =
          raw.length > MAX_FILE_SNIPPET_CHARS
            ? raw.slice(0, MAX_FILE_SNIPPET_CHARS) + '\n... (truncated)'
            : raw;
        if (totalChars + snippet.length > MAX_PRIORITY_CHARS) {
          priorityFiles['_notice'] =
            '(priority file budget exceeded; remaining files omitted)';
          break outer;
        }
        priorityFiles[relative(territoryPath, full)] = snippet;
        totalChars += snippet.length;
        count++;
        if (count >= 10) break outer;
      } catch {
        /* skip unreadable files */
      }
    }
  }
  return { fileListing, priorityFiles };
}
