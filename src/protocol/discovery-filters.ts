/**
 * Boilerplate filters for source code.
 *
 * Identifies and skips lines/patterns that are standard boilerplate
 * (imports, empty JSDoc, framework decorators, etc.) across multiple languages.
 * Used during discovery to save budget for informative content.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BoilerplateFilter {
  name: string;
  /** Languages this filter applies to (e.g. ['typescript', 'javascript']) */
  language: string[];
  /**
   * Test whether a line is boilerplate.
   * @param line - The current line (trimmed)
   * @param index - Line index in the array
   * @param lines - Full array of all lines (for context-aware filtering)
   */
  test: (line: string, index: number, lines: string[]) => boolean;
}

export interface FilterOptions {
  /** When true, also skip repetitive JSDoc and trivial type annotations */
  aggressive?: boolean;
}

export interface BoilerplateStats {
  totalLines: number;
  boilerplateLines: number;
  usefulLines: number;
  compressionRatio: number;
}

// ─── Supported Languages ─────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES: string[] = [
  'typescript',
  'javascript',
  'python',
  'rust',
];

// ─── Language Detection ──────────────────────────────────────────────────────

/**
 * Map file extensions to language identifiers.
 */
const EXTENSION_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
};

/**
 * Detect the programming language from a file extension.
 * Returns the language identifier or 'unknown' if unrecognized.
 */
export function detectLanguage(filePath: string): string {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return 'unknown';
  const ext = filePath.slice(dotIdx).toLowerCase();
  return EXTENSION_TO_LANG[ext] ?? 'unknown';
}

// ─── Standard Library Imports ────────────────────────────────────────────────

const NODE_STD_IMPORTS = new Set([
  'node:fs', 'node:path', 'node:http', 'node:https', 'node:os',
  'node:crypto', 'node:stream', 'node:buffer', 'node:url', 'node:util',
  'node:events', 'node:child_process', 'node:cluster', 'node:dgram',
  'node:dns', 'node:net', 'node:readline', 'node:tls', 'node:fs/promises',
  'node:stream/consumers', 'node:stream/promises', 'node:timers',
  'node:timers/promises', 'node:assert', 'node:process',
  'fs', 'path', 'http', 'https', 'os', 'crypto', 'stream', 'buffer',
  'url', 'util', 'events', 'child_process', 'cluster', 'dgram',
  'dns', 'net', 'readline', 'tls',
]);

const PYTHON_STD_IMPORTS = new Set([
  'os', 'sys', 'json', 're', 'math', 'datetime', 'collections', 'itertools',
  'functools', 'pathlib', 'typing', 'enum', 'dataclasses', 'abc',
  'hashlib', 'hmac', 'base64', 'uuid', 'copy', 'pprint', 'textwrap',
  'io', 'csv', 'string', 'random', 'statistics', 'decimal', 'fractions',
  'threading', 'multiprocessing', 'subprocess', 'logging', 'warnings',
  'traceback', 'inspect', 'types', 'time', 'calendar', 'zoneinfo',
  'argparse', 'configparser', 'tempfile', 'shutil', 'glob', 'fnmatch',
  'linecache', 'pickle', 'shelve', 'marshal', 'socketserver',
  'http.server', 'urllib', 'xml', 'html', 'http.cookies',
]);

const RUST_STD_CRATES = new Set([
  'std', 'std::fs', 'std::path', 'std::io', 'std::collections',
  'std::sync', 'std::thread', 'std::time', 'std::net', 'std::env',
  'std::process', 'std::fmt', 'std::error', 'std::result', 'std::option',
  'std::str', 'std::string', 'std::vec', 'std::boxed', 'std::rc',
  'std::cell', 'std::cmp', 'std::hash', 'std::iter', 'std::mem',
  'std::ops', 'std::ptr', 'std::slice', 'std::char',
]);

// ─── Framework Boilerplate ───────────────────────────────────────────────────

const TYPESCRIPT_FRAMEWORK_MODULES = new Set([
  'express', 'koa', 'fastify', 'hapi', 'restify',
  'react', 'react-dom', 'vue', 'svelte', 'angular',
  'next', 'nuxt', 'gatsby', 'remix',
  '@nestjs/core', '@nestjs/common', '@nestjs/platform-express',
  'typeorm', 'prisma', 'drizzle-orm', 'sequelize', 'mongoose',
  'zod', 'yup', 'joi',  // schema validators
  'vitest', 'jest', 'mocha', 'chai', 'sinon',
  'lodash', 'ramda', 'rxjs',
  'dayjs', 'luxon', 'date-fns',
  'axios', 'node-fetch', 'got',
  'commander', 'yargs', 'inquirer',
]);

const PYTHON_FRAMEWORK_MODULES = new Set([
  'django', 'flask', 'fastapi', 'bottle', 'pyramid', 'tornado',
  'aiohttp', 'sanic', 'starlette', 'uvicorn', 'gunicorn',
  'sqlalchemy', 'alembic', 'django.db', 'peewee', 'tortoise-orm',
  'pytest', 'unittest', 'mock',
  'numpy', 'pandas', 'scipy', 'scikit-learn', 'matplotlib',
  'celery', 'redis', 'requests',
  'pydantic', 'attrs',
  'asyncio', 'concurrent',
]);

// ─── Filter Definitions ──────────────────────────────────────────────────────

const FILTERS: BoilerplateFilter[] = [
  // ── TypeScript / JavaScript ──────────────────────────────────────────────
  {
    name: 'ts-node-std-import',
    language: ['typescript', 'javascript'],
    test: (line: string) => {
      // import ... from 'node:*' or from 'fs'/'path'/'os'/etc
      const match = line.match(/import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/);
      if (match) {
        return NODE_STD_IMPORTS.has(match[1]);
      }
      // require('node:*') or require('fs'), etc.
      const requireMatch = line.match(/(?:const|let|var)\s+.+=\s*require\(['"]([^'"]+)['"]\)/);
      if (requireMatch) {
        return NODE_STD_IMPORTS.has(requireMatch[1]);
      }
      return false;
    },
  },
  {
    name: 'ts-framework-import',
    language: ['typescript', 'javascript'],
    test: (line: string) => {
      const match = line.match(/import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/);
      if (match) {
        const mod = match[1];
        // Check exact match or if it starts with a framework module prefix
        if (TYPESCRIPT_FRAMEWORK_MODULES.has(mod)) return true;
        // Also match scoped packages like @nestjs/*
        if (mod.startsWith('@')) {
          const scopePrefix = mod.split('/').slice(0, 2).join('/');
          if (TYPESCRIPT_FRAMEWORK_MODULES.has(scopePrefix)) return true;
        }
      }
      return false;
    },
  },
  {
    name: 'ts-empty-jsdoc',
    language: ['typescript', 'javascript'],
    test: (line: string) => {
      // Empty or trivial JSDoc: /** */, /** some text */ (without @param/@returns)
      const trimmed = line.trim();
      if (/^\/\*\*\s*\*\/$/.test(trimmed)) return true; // /**/
      if (/^\/\*\*\s*(?:desc|description)?\s*\*\/$/i.test(trimmed)) return true; // /** desc */
      // Starting or ending a JSDoc block — only skip if truly empty content
      return false;
    },
  },
  {
    name: 'ts-trivial-export',
    language: ['typescript', 'javascript'],
    test: (line: string) => {
      const trimmed = line.trim();
      // export {}  (empty export)
      if (/^export\s+\{\s*\};?$/.test(trimmed)) return true;
      // export type {} or export interface {} (empty)
      if (/^export\s+(?:type|interface)\s+\{\s*\};?$/.test(trimmed)) return true;
      // 'use strict'
      if (/^['"]use strict['"];?$/.test(trimmed)) return true;
      return false;
    },
  },

  // ── Python ───────────────────────────────────────────────────────────────
  {
    name: 'py-std-import',
    language: ['python'],
    test: (line: string) => {
      const trimmed = line.trim();
      // import os, import sys, etc.
      const importMatch = trimmed.match(/^import\s+([a-zA-Z_][a-zA-Z0-9_.]*)/);
      if (importMatch) {
        const topModule = importMatch[1].split('.')[0];
        return PYTHON_STD_IMPORTS.has(topModule);
      }
      // from os import path, from typing import Optional, etc.
      const fromMatch = trimmed.match(/^from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import/);
      if (fromMatch) {
        const topModule = fromMatch[1].split('.')[0];
        return PYTHON_STD_IMPORTS.has(topModule);
      }
      return false;
    },
  },
  {
    name: 'py-framework-import',
    language: ['python'],
    test: (line: string) => {
      const trimmed = line.trim();
      const importMatch = trimmed.match(/^import\s+([a-zA-Z_][a-zA-Z0-9_.]*)/);
      if (importMatch) {
        const topModule = importMatch[1].split('.')[0];
        return PYTHON_FRAMEWORK_MODULES.has(topModule);
      }
      const fromMatch = trimmed.match(/^from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import/);
      if (fromMatch) {
        const topModule = fromMatch[1].split('.')[0];
        return PYTHON_FRAMEWORK_MODULES.has(topModule);
      }
      return false;
    },
  },
  {
    name: 'py-trivial-decorator',
    language: ['python'],
    test: (line: string) => {
      const trimmed = line.trim();
      // @dataclass, @staticmethod, @classmethod, @property
      if (/^@(dataclass|staticmethod|classmethod|property)\s*$/.test(trimmed)) return true;
      return false;
    },
  },
  {
    name: 'py-trivial-pass',
    language: ['python'],
    test: (line: string) => {
      return /^pass\s*$/.test(line.trim());
    },
  },

  // ── Rust ─────────────────────────────────────────────────────────────────
  {
    name: 'rs-std-import',
    language: ['rust'],
    test: (line: string) => {
      const trimmed = line.trim();
      // use std::*, use std::fs::*, etc.
      const match = trimmed.match(/^use\s+(std(?:::\w+)*)/);
      if (match) {
        // Check if it starts with a known std crate
        for (const prefix of RUST_STD_CRATES) {
          if (match[1] === prefix || match[1].startsWith(prefix + '::')) return true;
        }
      }
      return false;
    },
  },
  {
    name: 'rs-trivial-derive',
    language: ['rust'],
    test: (line: string) => {
      const trimmed = line.trim();
      // #[derive(...)] — skip common derives
      if (/^#\[derive\(.*\)\]$/.test(trimmed)) return true;
      return false;
    },
  },
];

// ─── Aggressive Filters ──────────────────────────────────────────────────────

const AGGRESSIVE_FILTERS: BoilerplateFilter[] = [
  {
    name: 'aggressive-jsdoc-block',
    language: ['typescript', 'javascript'],
    test: (line: string) => {
      const trimmed = line.trim();
      // Detect JSDoc block start/end
      if (/^\/\*\*$/.test(trimmed)) return true;  /** opening */
      if (/^\s*\*\/$/.test(trimmed)) return true;  // */ closing
      if (/^\s*\*\s*$/.test(trimmed)) return true; // * (empty doc line)
      if (/^\s*\*\s*(@\w+\s+.*)?$/.test(trimmed) && !/\b@(param|returns|throws|example)\b/.test(trimmed)) {
        // JSDoc lines without meaningful tags
        return true;
      }
      return false;
    },
  },
  {
    name: 'aggressive-trivial-type-annotation',
    language: ['typescript', 'javascript'],
    test: (line: string) => {
      const trimmed = line.trim();
      // Trivial variable declarations without value: let x: string; const y: number;
      if (/^(let|const|var)\s+\w+\s*:\s*(string|number|boolean|any|unknown|never|void)\s*;?$/.test(trimmed)) return true;
      // Trivial type alias: type X = string;
      if (/^type\s+\w+\s*=\s*(string|number|boolean|any|unknown|never|void)\s*;?$/.test(trimmed)) return true;
      return false;
    },
  },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Filter boilerplate lines from source code content.
 *
 * @param content - Raw file content
 * @param language - Language identifier ('typescript', 'python', 'rust', etc.)
 * @param options - Optional filtering configuration
 * @returns Content with boilerplate lines removed
 */
export function filterBoilerplate(
  content: string,
  language: string,
  options: FilterOptions = {},
): string {
  const lines = content.split('\n');
  const filtered: string[] = [];
  const activeFilters = FILTERS.filter((f) => f.language.includes(language));
  let aggressiveFilters: BoilerplateFilter[] = [];
  if (options.aggressive) {
    aggressiveFilters = AGGRESSIVE_FILTERS.filter((f) => f.language.includes(language));
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let isBoilerplate = false;

    for (const filter of activeFilters) {
      if (filter.test(line, i, lines)) {
        isBoilerplate = true;
        break;
      }
    }

    if (!isBoilerplate && options.aggressive) {
      for (const filter of aggressiveFilters) {
        if (filter.test(line, i, lines)) {
          isBoilerplate = true;
          break;
        }
      }
    }

    if (!isBoilerplate) {
      filtered.push(line);
    }
  }

  return filtered.join('\n');
}

/**
 * Get statistics about boilerplate removal.
 *
 * @param content - Raw file content
 * @param language - Language identifier
 * @returns Statistics about the filtering
 */
export function getBoilerplateStats(
  content: string,
  language: string,
): BoilerplateStats {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const filteredContent = filterBoilerplate(content, language);
  const usefulLines = filteredContent === '' ? 0 : filteredContent.split('\n').length;
  const boilerplateLines = totalLines - usefulLines;

  return {
    totalLines,
    boilerplateLines,
    usefulLines,
    compressionRatio: totalLines > 0
      ? Math.round((boilerplateLines / totalLines) * 100)
      : 0,
  };
}