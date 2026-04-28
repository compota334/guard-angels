import * as fs from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createAngelDraft } from '../angels/draft.js';
import { loadConfig } from '../config/load.js';
import type { AngelEntry } from '../config/schema.js';
import { configFile } from '../paths/layout.js';
import { pathToAngelId } from '../paths/resolve.js';

/**
 * Create a new angel for a specific folder.
 *
 * - Loads the existing _config.yml
 * - Validates the path (exists, is a directory, inside project root)
 * - Checks for duplicate ID or path in the registry
 * - Creates draft angel.md (with ingestion if AGENTS.md/CLAUDE.md exists)
 * - Appends the new entry to _config.yml
 */
export async function createAngel(cwd: string, folderPath: string): Promise<void> {
  // Normalize the path: strip leading/trailing slashes, collapse duplicates
  const normalized = folderPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');

  if (normalized === '' || normalized === '.') {
    throw new Error(
      'Cannot create an angel for the project root. The _root angel is created by "angels init".',
    );
  }

  // Load existing config first (fails clearly if project isn't initialized)
  const config = loadConfig(cwd);

  // Validate the folder exists and is inside the project root
  const absoluteFolder = resolve(join(cwd, normalized));
  const absoluteRoot = resolve(cwd);

  if (!absoluteFolder.startsWith(absoluteRoot + '/')) {
    throw new Error(
      `Path "${folderPath}" resolves to ${absoluteFolder}, which is outside the project root ${absoluteRoot}.`,
    );
  }

  try {
    const stat = fs.statSync(absoluteFolder);
    if (!stat.isDirectory()) {
      throw new Error(
        `"${normalized}" exists but is not a directory.`,
      );
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Folder "${normalized}" does not exist at ${absoluteFolder}.`,
        { cause: err },
      );
    }
    throw err;
  }

  // Compute the angel ID
  const angelId = pathToAngelId(normalized);

  // Check for duplicates
  for (const existing of config.angels) {
    if (existing.id === angelId) {
      throw new Error(
        `An angel with id "${angelId}" already exists (path: "${existing.path}").`,
      );
    }
    if (existing.path === normalized) {
      throw new Error(
        `An angel already exists for path "${normalized}" (id: "${existing.id}").`,
      );
    }
  }

  // Build the new entry
  const newEntry: AngelEntry = {
    id: angelId,
    type: 'folder',
    path: normalized,
  };

  // Create the draft angel.md (with ingestion if applicable)
  await createAngelDraft(config, newEntry, cwd);

  // Append the new angel to _config.yml
  const cfgPath = configFile(cwd);
  const rawConfig = fs.readFileSync(cfgPath, 'utf-8');
  const parsedConfig = parseYaml(rawConfig) as Record<string, unknown>;
  const angels = parsedConfig.angels as Array<Record<string, unknown>>;
  angels.push({ id: newEntry.id, type: newEntry.type, path: newEntry.path });
  const updatedYaml = stringifyYaml(parsedConfig, { lineWidth: 0 });
  fs.writeFileSync(cfgPath, updatedYaml, 'utf-8');

  console.log(`Angel "${angelId}" registered for folder "${normalized}".`);
}
