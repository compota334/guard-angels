import * as fs from 'node:fs';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { angelMdFile } from '../paths/layout.js';
import { angelIdToPath } from '../paths/resolve.js';

/**
 * Print the current angel.md for the given angel ID.
 *
 * Validates angel exists in the registry, then reads its angel.md.
 * Warns if the file has no body content (only frontmatter).
 */
export function showAngel(cwd: string, angelId: string): void {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  const angelPath = angelIdToPath(angelId);
  const mdPath = angelMdFile(cwd, angelPath === '.' ? '_root' : angelPath);

  let raw: string;
  try {
    raw = fs.readFileSync(mdPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `Angel "${angelId}" is registered but has no angel.md at ${mdPath}. Run "angels onboard --angel ${angelId}" to initialize it.`,
        { cause: err },
      );
    }
    throw err;
  }

  // Warn if body is empty (only frontmatter or blank after it)
  const closingIdx = raw.indexOf('\n---', 4);
  if (closingIdx !== -1) {
    const bodyStart = closingIdx + '\n---\n'.length;
    const body = bodyStart < raw.length ? raw.slice(bodyStart) : '';
    if (!body.trim()) {
      console.warn(
        `Warning: angel "${angelId}" has no body content (only frontmatter). The angel may not have been onboarded yet.`,
      );
    }
  }

  console.log(`=== angel.md: ${angelId} ===`);
  console.log(`Path: ${mdPath}`);
  console.log('');
  console.log(raw.trim());
}
