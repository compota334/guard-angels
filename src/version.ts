import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// package.json sits one level above this module's directory, both in
// src/ (tests, ts-node) and in dist/ (built output).
const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

export const CLI_VERSION: string = pkg.version;
