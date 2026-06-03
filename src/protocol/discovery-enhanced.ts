/**
 * Enhanced Discovery — Deep context builder for large territories.
 *
 * Replaces (extends) the functionality of discovery.ts for contexts where
 * memory.target_pct > 5. discovery.ts is NOT modified — this file coexists
 * for backward compatibility.
 *
 * Fase 2: Deep Discovery
 * - File classification (high/medium/low)
 * - Dynamic budget allocation (80/15/5)
 * - Deep reading with boilerplate filtering
 * - Reference counting for high-value detection
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveMemoryConfig } from '../config/defaults.js';
import type { MemoryConfig } from '../config/schema.js';
import {
  filterBoilerplate,
  getBoilerplateStats,
  detectLanguage,
} from './discovery-filters.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FileValue = 'high' | 'medium' | 'low';

export interface ClassifiedFile {
  path: string;
  value: FileValue;
  sizeBytes: number;
  language: string;
  reason: string;
}

export interface DeepDiscoveryContext {
  territoryPath: string;
  fileCount: number;
  classifiedFiles: ClassifiedFile[];
  highValueContent: string;
  mediumValueStubs: string;
  lowValueListing: string;
  totalTokens: number;
  budgetUsed: number;
  memoryConfig: { targetPct: number; maxTokens: number };
  stats: {
    totalFiles: number;
    highValueFiles: number;
    mediumValueFiles: number;
    lowValueFiles: number;
    boilerplateLinesSkipped: number;
    usefulLinesKept: number;
    compressionRatio: number;
  };
}

// ─── Scaffold / Binary filters (mirrors discovery.ts for consistency) ────────

const SCAFFOLD_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  '.venv',
  'venv',
  'env',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  'out',
  'coverage',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.eggs',
]);

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pyc',
  '.pyo',
  '.pyd',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.bin',
  '.o',
  '.a',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.ico',
  '.webp',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.pdf',
]);

function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && BINARY_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function pathHasScaffoldDir(rel: string): boolean {
  return rel.split('/').some((seg) => SCAFFOLD_DIRS.has(seg));
}

// ─── Classification Patterns ─────────────────────────────────────────────────

const HIGH_VALUE_PATTERNS: RegExp[] = [
  /service(s)?\.[a-z]+$/i,
  /controller(s)?\.[a-z]+$/i,
  /handler(s)?\.[a-z]+$/i,
  /manager(s)?\.[a-z]+$/i,
  /provider(s)?\.[a-z]+$/i,
  /processor(s)?\.[a-z]+$/i,
  /engine\.[a-z]+$/i,
  /resolver(s)?\.[a-z]+$/i,
  /action(s)?\.[a-z]+$/i,
  /command(s)?\.[a-z]+$/i,
  /use[_-]?case(s)?\.[a-z]+$/i,
  /application\.[a-z]+$/i,
  /domain\.[a-z]+$/i,
  /state[_-]?machine\.[a-z]+$/i,
  /workflow(s)?\.[a-z]+$/i,
  /pipeline\.[a-z]+$/i,
  /schema(s)?\.[a-z]+$/i,
  /type(s)?\.[a-z]+$/i,
  /interface(s)?\.[a-z]+$/i,
  /model(s)?\.[a-z]+$/i,
  /entity\.[a-z]+$/i,
  /dto(s)?\.[a-z]+$/i,
  /validator(s)?\.[a-z]+$/i,
  /config\.[a-z]+$/i,
  /main\.[a-z]+$/i,
  /app\.[a-z]+$/i,
  /module(s)?\.[a-z]+$/i,
  /\.(test|spec)\.[a-z]+$/i,
];

const MEDIUM_VALUE_PATTERNS: RegExp[] = [
  /middleware\.[a-z]+$/i,
  /route(s)?\.[a-z]+$/i,
  /helper(s)?\.[a-z]+$/i,
  /util(s)?\.[a-z]+$/i,
  /wrapper(s)?\.[a-z]+$/i,
  /adapter(s)?\.[a-z]+$/i,
  /decorator(s)?\.[a-z]+$/i,
  /guard(s)?\.[a-z]+$/i,
  /filter(s)?\.[a-z]+$/i,
  /pipe(s)?\.[a-z]+$/i,
  /interceptor(s)?\.[a-z]+$/i,
  /plugin(s)?\.[a-z]+$/i,
  /constant(s)?\.[a-z]+$/i,
  /enum(s)?\.[a-z]+$/i,
  /error(s)?\.[a-z]+$/i,
  /exception(s)?\.[a-z]+$/i,
  /logger\.[a-z]+$/i,
  /dockerfile/i,
  /makefile/i,
  /\.ya?ml$/i,
  /\.json$/i,
  /\.env/i,
];

const LOW_VALUE_PATTERNS: RegExp[] = [
  /index\.[a-z]+$/i,
  /\.generated\.[a-z]+$/i,
  /\.g\.[a-z]+$/i,
  /generated/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.ya?ml$/i,
  /tsconfig\.json$/i,
  /\.eslintrc/i,
  /\.prettierrc/i,
  /babel\.config/i,
  /postcss\.config/i,
  /webpack\.config/i,
  /vite\.config/i,
  /next\.config/i,
  /nuxt\.config/i,
  /\.d\.ts$/i,
  /fixture(s)?\.[a-z]+$/i,
  /mock(s)?\.[a-z]+$/i,
  /stub(s)?\.[a-z]+$/i,
];

// ─── Import Extraction (for reference counting) ──────────────────────────────

/**
 * Extract import/require paths from file content based on language.
 */
function extractImports(content: string, language: string): string[] {
  const imports: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (language === 'typescript' || language === 'javascript') {
      // import { ... } from 'path'
      const fromMatch = trimmed.match(
        /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+(?:,\s*(?:{[^}]*}|\*\s+as\s+\w+|\w+))?)\s+from\s+['"]([^'"]+)['"]/,
      );
      if (fromMatch) {
        imports.push(fromMatch[1]);
        continue;
      }
      // import 'path' (side-effect import)
      const sideEffect = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
      if (sideEffect) {
        imports.push(sideEffect[1]);
        continue;
      }
      // require('path')
      const requireMatch = trimmed.match(
        /(?:const|let|var)\s+.+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (requireMatch) {
        imports.push(requireMatch[1]);
      }
    } else if (language === 'python') {
      const importMatch = trimmed.match(/^import\s+([a-zA-Z_][a-zA-Z0-9_.]*)/);
      if (importMatch) {
        imports.push(importMatch[1]);
        continue;
      }
      const fromMatch = trimmed.match(
        /^from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import/,
      );
      if (fromMatch) {
        imports.push(fromMatch[1]);
      }
    } else if (language === 'rust') {
      const useMatch = trimmed.match(/^use\s+([^;]+)/);
      if (useMatch) {
        imports.push(useMatch[1]);
      }
    }
  }

  return imports;
}

/**
 * Resolve a relative import path against the file's directory.
 * Returns null for non-relative imports (external packages).
 */
function resolveImportPath(
  importPath: string,
  fileDir: string,
): string | null {
  if (importPath.startsWith('.')) {
    return join(fileDir, importPath);
  }
  return null;
}

/**
 * Common extensions to try when resolving relative imports.
 */
const COMMON_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '/index.ts',
  '/index.js',
  '.py',
  '.rs',
];

// ─── File Listing ────────────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  fullPath: string;
  sizeBytes: number;
  language: string;
}

function listFiles(territoryPath: string): FileEntry[] {
  if (!existsSync(territoryPath)) return [];

  const all = readdirSync(territoryPath, { recursive: true, withFileTypes: true });
  const files: FileEntry[] = [];

  for (const entry of all) {
    if (entry.isDirectory()) continue;
    const rel = relative(
      territoryPath,
      join(entry.parentPath ?? territoryPath, entry.name),
    );
    if (pathHasScaffoldDir(rel)) continue;
    if (isBinaryFile(entry.name)) continue;

    const fullPath = join(entry.parentPath ?? territoryPath, entry.name);
    const stats = statSync(fullPath);

    files.push({
      path: rel,
      fullPath,
      sizeBytes: stats.size,
      language: detectLanguage(entry.name),
    });
  }

  return files;
}

// ─── Public: classifyFiles ───────────────────────────────────────────────────

/**
 * Classify files into high/medium/low value based on path patterns,
 * file content heuristics, and cross-file reference counting.
 *
 * @param files - List of relative file paths
 * @param territoryPath - Root directory of the territory
 * @returns Array of classified file entries
 */
export async function classifyFiles(
  files: string[],
  territoryPath: string,
): Promise<ClassifiedFile[]> {
  // Build file entries
  const fileEntries: FileEntry[] = files.map((f) => {
    const fullPath = join(territoryPath, f);
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(fullPath).size;
    } catch {
      /* ignore */
    }
    return {
      path: f,
      fullPath,
      sizeBytes,
      language: detectLanguage(f),
    };
  });

  // Pass 1: extract imports from every readable code file to build reference counts
  const referenceCount = new Map<string, number>();

  for (const entry of fileEntries) {
    if (entry.language === 'unknown') continue;
    try {
      const content = readFileSync(entry.fullPath, 'utf-8');
      if (content.includes('\0')) continue;
      const imports = extractImports(content, entry.language);
      const fileDir = join(
        territoryPath,
        entry.path.split('/').slice(0, -1).join('/'),
      );

      for (const imp of imports) {
        const resolved = resolveImportPath(imp, fileDir);
        if (!resolved) continue;
        const relPath = relative(territoryPath, resolved);

        // Try matching against known file paths with common extensions
        for (const ext of COMMON_EXTENSIONS) {
          const candidate = (relPath + ext).replace(/\\/g, '/');
          if (fileEntries.some((e) => e.path === candidate)) {
            referenceCount.set(
              candidate,
              (referenceCount.get(candidate) ?? 0) + 1,
            );
            break;
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  // Pass 2: classify each file
  const classified: ClassifiedFile[] = [];

  for (const entry of fileEntries) {
    const refCount = referenceCount.get(entry.path) ?? 0;
    const name = entry.path.split('/').pop() ?? entry.path;

    // Check low-value patterns first (highest priority)
    let matched = false;
    for (const p of LOW_VALUE_PATTERNS) {
      if (p.test(entry.path) || p.test(name)) {
        classified.push({
          path: entry.path,
          value: 'low',
          sizeBytes: entry.sizeBytes,
          language: entry.language,
          reason: `Pattern match: ${p.source}`,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Check high-value patterns
    for (const p of HIGH_VALUE_PATTERNS) {
      if (p.test(entry.path) || p.test(name)) {
        classified.push({
          path: entry.path,
          value: 'high',
          sizeBytes: entry.sizeBytes,
          language: entry.language,
          reason: `Pattern match: ${p.source}`,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Elevate to high if referenced by 3+ other files
    if (refCount >= 3) {
      classified.push({
        path: entry.path,
        value: 'high',
        sizeBytes: entry.sizeBytes,
        language: entry.language,
        reason: `Referenced by ${refCount} other files (high import count)`,
      });
      continue;
    }

    // Check medium-value patterns
    for (const p of MEDIUM_VALUE_PATTERNS) {
      if (p.test(entry.path) || p.test(name)) {
        classified.push({
          path: entry.path,
          value: 'medium',
          sizeBytes: entry.sizeBytes,
          language: entry.language,
          reason: `Pattern match: ${p.source}`,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Default classification based on language
    if (entry.language !== 'unknown') {
      classified.push({
        path: entry.path,
        value: 'medium',
        sizeBytes: entry.sizeBytes,
        language: entry.language,
        reason: 'Unclassified code file — default to medium',
      });
    } else {
      classified.push({
        path: entry.path,
        value: 'low',
        sizeBytes: entry.sizeBytes,
        language: entry.language,
        reason: 'Unknown file type or non-code file',
      });
    }
  }

  return classified;
}

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Rough token estimate: ~4 characters per token for code/documentation text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Public: buildDeepDiscoveryContext ────────────────────────────────────────

/**
 * Build a deep discovery context for a territory, using dynamic budget
 * allocation based on memory config.
 *
 * Budget distribution:
 * - 80% → high value files (full read + boilerplate filtering)
 * - 15% → medium value files (stub: first 50 filtered lines)
 * -  5% → low value files (names only, one-line purpose)
 *
 * @param territoryPath - Absolute path to the territory root
 * @param memoryConfig - Memory configuration (from schema)
 * @param contextWindow - Total LLM context window in tokens (default: 128K)
 * @returns Deep discovery context with classified files and filtered content
 */
export async function buildDeepDiscoveryContext(
  territoryPath: string,
  memoryConfig: MemoryConfig,
  contextWindow: number = 128_000,
): Promise<DeepDiscoveryContext> {
  const resolvedMemory = resolveMemoryConfig(memoryConfig, contextWindow);
  const maxTokens = resolvedMemory.maxTokens;

  // 1. List all files in territory
  const allFiles = listFiles(territoryPath);
  const filePaths = allFiles.map((f) => f.path);

  // 2. Classify files
  const classifiedFiles = await classifyFiles(filePaths, territoryPath);

  // Separate by value class
  const highFiles = classifiedFiles.filter((f) => f.value === 'high');
  const mediumFiles = classifiedFiles.filter((f) => f.value === 'medium');
  const lowFiles = classifiedFiles.filter((f) => f.value === 'low');

  // Budget distribution
  const highBudget = Math.floor(maxTokens * 0.8);
  const mediumBudget = Math.floor(maxTokens * 0.15);

  // 3. Deep read high-value files (full content + boilerplate filtering)
  const highValueParts: string[] = [];
  let highTokensUsed = 0;
  let boilerplateSkipped = 0;
  let usefulKept = 0;

  for (const cf of highFiles) {
    if (highTokensUsed >= highBudget) {
      highValueParts.push(
        `\n### ${cf.path}\n(truncated — budget for high-value files exhausted)\n`,
      );
      continue;
    }

    try {
      const content = readFileSync(join(territoryPath, cf.path), 'utf-8');
      if (content.includes('\0')) {
        highValueParts.push(`\n### ${cf.path}\n(binary or unreadable)\n`);
        continue;
      }

      const totalLines = content.split('\n').length;
      let filtered: string;

      if (cf.language === 'unknown') {
        filtered = content;
      } else {
        filtered = filterBoilerplate(content, cf.language, {
          aggressive: true,
        });
        const stats = getBoilerplateStats(content, cf.language);
        boilerplateSkipped += stats.boilerplateLines;
        usefulKept += stats.usefulLines;
      }

      const usefulLines = filtered === '' ? 0 : filtered.split('\n').length;
      const filteredTokens = estimateTokens(filtered);

      // Check if we need to truncate
      if (highTokensUsed + filteredTokens > highBudget) {
        const remaining = highBudget - highTokensUsed;
        const charsAllowed = remaining * 4;
        const truncated = filtered.slice(0, charsAllowed);
        highValueParts.push(
          `\n### ${cf.path}\n` +
            `*Metadata: ${totalLines} total lines, ~${usefulLines} useful lines*` +
            ` (~${Math.round((1 - usefulLines / Math.max(totalLines, 1)) * 100)}% boilerplate removed)*\n` +
            '```\n' +
            truncated +
            '\n```\n' +
            '*(truncated to fit budget)*\n',
        );
        highTokensUsed += remaining;
        break;
      }

      highValueParts.push(
        `\n### ${cf.path}\n` +
          `*Metadata: ${totalLines} total lines, ~${usefulLines} useful lines*` +
          ` (~${Math.round((1 - usefulLines / Math.max(totalLines, 1)) * 100)}% boilerplate)*\n` +
          '```\n' +
          filtered +
          '\n```\n',
      );
      highTokensUsed += filteredTokens;
    } catch {
      highValueParts.push(`\n### ${cf.path}\n(unreadable)\n`);
    }
  }

  const highValueContent = highValueParts.join('').trim();

  // 4. Stub read medium-value files (first 50 filtered lines)
  const mediumParts: string[] = [];
  let mediumTokensUsed = 0;

  for (const cf of mediumFiles) {
    if (mediumTokensUsed >= mediumBudget) {
      mediumParts.push(`\n### ${cf.path} — (budget exhausted, omitted)\n`);
      continue;
    }

    try {
      const content = readFileSync(join(territoryPath, cf.path), 'utf-8');
      if (content.includes('\0')) continue;

      let filtered: string;
      if (cf.language === 'unknown') {
        filtered = content;
      } else {
        filtered = filterBoilerplate(content, cf.language, {
          aggressive: true,
        });
        const stats = getBoilerplateStats(content, cf.language);
        boilerplateSkipped += stats.boilerplateLines;
        usefulKept += stats.usefulLines;
      }

      const lines = filtered.split('\n');
      const stubLines = lines.slice(0, 50);
      const stub = stubLines.join('\n');
      const stubTokens = estimateTokens(stub);

      if (mediumTokensUsed + stubTokens > mediumBudget) {
        const remaining = mediumBudget - mediumTokensUsed;
        const charsAllowed = remaining * 4;
        const truncated = stub.slice(0, charsAllowed);
        mediumParts.push(
          `\n### ${cf.path}\n*(stub truncated to fit budget)*\n\`\`\`\n${truncated}\n\`\`\`\n`,
        );
        mediumTokensUsed += remaining;
        break;
      }

      mediumParts.push(
        `\n### ${cf.path}\n` +
          '```\n' +
          stub +
          '\n```\n' +
          (lines.length > 50
            ? `*(stub — ${lines.length - 50} more lines omitted)*\n`
            : ''),
      );
      mediumTokensUsed += stubTokens;
    } catch {
      /* skip unreadable */
    }
  }

  const mediumValueStubs = mediumParts.join('').trim();

  // 5. Low-value listing (names + reason)
  const lowLines: string[] = [];
  for (const cf of lowFiles) {
    lowLines.push(`- \`${cf.path}\` — ${cf.reason}`);
  }
  const lowValueListing = lowLines.join('\n');

  // 6. Compute aggregate stats
  const totalTokens =
    highTokensUsed +
    mediumTokensUsed +
    estimateTokens(lowValueListing);

  const budgetUsed =
    maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;

  const totalFilteredLines = boilerplateSkipped + usefulKept;

  return {
    territoryPath,
    fileCount: allFiles.length,
    classifiedFiles,
    highValueContent,
    mediumValueStubs,
    lowValueListing,
    totalTokens,
    budgetUsed,
    memoryConfig: {
      targetPct: resolvedMemory.targetPct,
      maxTokens,
    },
    stats: {
      totalFiles: allFiles.length,
      highValueFiles: highFiles.length,
      mediumValueFiles: mediumFiles.length,
      lowValueFiles: lowFiles.length,
      boilerplateLinesSkipped: boilerplateSkipped,
      usefulLinesKept: usefulKept,
      compressionRatio:
        totalFilteredLines > 0
          ? Math.round(
              (boilerplateSkipped / totalFilteredLines) * 100,
            )
          : 0,
    },
  };
}

// ─── Public: estimateAngelMdSize ─────────────────────────────────────────────

/**
 * Estimate the approximate token size of the angel.md that would be
 * generated from this deep discovery context.
 *
 * The estimation accounts for the fact that the angel.md will be
 * more condensed than raw code:
 * - High value content → ~60% token count
 * - Medium value stubs → ~40% token count
 * - Structure overhead (sections, headers) → ~1250 tokens
 *
 * @param discoveryContext - The deep discovery context to estimate from
 * @returns Estimated token count for the generated angel.md
 */
export function estimateAngelMdSize(
  discoveryContext: DeepDiscoveryContext,
): number {
  const highTokens = estimateTokens(discoveryContext.highValueContent);
  const mediumTokens = estimateTokens(discoveryContext.mediumValueStubs);

  // Angel md is denser than raw filtered code
  const highCompression = Math.round(highTokens * 0.6);
  const mediumCompression = Math.round(mediumTokens * 0.4);
  const structureOverhead = 1250; // ~5000 chars / 4 tokens

  return highCompression + mediumCompression + structureOverhead;
}
