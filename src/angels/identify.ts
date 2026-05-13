import { readdir, realpath } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';

const MAX_DEPTH = 10;
const MAX_RESULTS = 200;

/**
 * Folders to skip during candidate identification.
 * Matches common build outputs, dependencies, hidden/system dirs.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.angels',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.vite',
  '.cache',
  '.turbo',
  '__pycache__',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  'site-packages',
  '.eggs',
  '.ruff_cache',
  'vendor',
  'target',
  '.idea',
  '.vscode',
]);

/**
 * Generic folder names that are NOT considered significant on their own
 * unless they meet another criterion (file count or index file).
 */
const GENERIC_NAMES = new Set([
  'utils',
  'util',
  'helpers',
  'helper',
  'lib',
  'libs',
  'common',
  'shared',
  'misc',
  'tmp',
  'temp',
  'types',
  'typings',
  'interfaces',
  'constants',
  'config',
  'configs',
  'assets',
  'static',
  'public',
  'scripts',
  'tools',
]);

/**
 * Source file extensions considered when counting files.
 */
export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.scala',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.vue',
  '.svelte',
]);

/**
 * Index/main file basenames (without extension) that indicate significance.
 */
const INDEX_BASENAMES = new Set([
  'index',
  'main',
  'mod',
  'app',
]);

export interface FolderCandidate {
  /** Path relative to projectRoot */
  path: string;
  /** Human-readable reason this folder was selected */
  reason: string;
  /** Number of direct source files (by SOURCE_EXTENSIONS) in this folder */
  sourceFileCount: number;
}

export interface IdentifyOptions {
  /** Additional directory names to skip (merged with defaults) */
  skipDirs?: string[];
}

/**
 * Walk a project tree and return folder candidates deemed significant
 * per the heuristics in app requeriments.md section 12:
 * - At least 3 source files
 * - A non-generic name
 * - Contains an index/main file
 *
 * Skips node_modules, dist, .git, .angels, and other common build outputs.
 * Does NOT return the project root itself (that's always _root).
 */
export async function identifyCandidates(
  projectRoot: string,
  opts?: IdentifyOptions,
): Promise<FolderCandidate[]> {
  const skipSet = new Set(SKIP_DIRS);
  if (opts?.skipDirs) {
    for (const dir of opts.skipDirs) {
      skipSet.add(dir);
    }
  }

  const candidates: FolderCandidate[] = [];
  const visited = new Set<string>();
  await walkDir(projectRoot, projectRoot, skipSet, candidates, 0, visited);
  if (candidates.length >= MAX_RESULTS) {
    console.warn(
      `[guard-angel] identifyCandidates: result cap of ${MAX_RESULTS} reached; some folders may be omitted`,
    );
  }
  return candidates;
}

async function walkDir(
  currentDir: string,
  projectRoot: string,
  skipSet: Set<string>,
  candidates: FolderCandidate[],
  depth: number,
  visited: Set<string>,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  if (candidates.length >= MAX_RESULTS) return;

  let real: string;
  try {
    real = await realpath(currentDir);
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  const subdirs: string[] = [];
  let sourceFileCount = 0;
  let hasIndexFile = false;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skipSet.has(entry.name) && !entry.name.startsWith('.')) {
        subdirs.push(join(currentDir, entry.name));
      }
    } else if (entry.isFile()) {
      const ext = getExtension(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        sourceFileCount++;
        const baseName = getBasename(entry.name);
        if (INDEX_BASENAMES.has(baseName)) {
          hasIndexFile = true;
        }
      }
    }
  }

  // Evaluate this folder (skip the project root itself)
  if (currentDir !== projectRoot) {
    const relPath = relative(projectRoot, currentDir);
    const dirName = basename(currentDir);
    const isGenericName = GENERIC_NAMES.has(dirName.toLowerCase());

    const reasons: string[] = [];

    if (sourceFileCount >= 3) {
      reasons.push(`has ${sourceFileCount} source files`);
    }

    if (!isGenericName) {
      reasons.push(`non-generic name "${dirName}"`);
    }

    if (hasIndexFile) {
      reasons.push('contains an index/main file');
    }

    if (reasons.length > 0) {
      candidates.push({
        path: relPath,
        reason: reasons.join('; '),
        sourceFileCount,
      });
    }
  }

  // Recurse into subdirectories
  for (const subdir of subdirs) {
    if (candidates.length >= MAX_RESULTS) break;
    await walkDir(subdir, projectRoot, skipSet, candidates, depth + 1, visited);
  }
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === 0) return '';
  return filename.slice(dot);
}

function getBasename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === 0) return filename;
  return filename.slice(0, dot);
}
