import * as fs from 'node:fs';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readAngelMd, writeAngelMd } from '../angels/memory.js';
import { angelMdFile } from '../paths/layout.js';
import { angelIdToPath } from '../paths/resolve.js';
import type { AngelEntry } from '../config/schema.js';

export interface ActivateOptions {
  all?: boolean;
}

export async function activateAngels(
  cwd: string,
  angelId: string | undefined,
  opts: ActivateOptions,
): Promise<void> {
  if (angelId === undefined && !opts.all) {
    throw new Error(
      'Specify an angel ID to activate or pass --all to activate all draft angels.',
    );
  }

  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);

  const targets: ReadonlyArray<AngelEntry> =
    angelId !== undefined ? [registry.getById(angelId)] : registry.listAll();

  let activated = 0;
  let skipped = 0;

  for (const angel of targets) {
    const angelPath = angelIdToPath(angel.id);
    const mdPath = angelMdFile(cwd, angelPath);

    if (!fs.existsSync(mdPath)) {
      console.log(`  ${angel.id}: no angel.md found, skipping.`);
      skipped++;
      continue;
    }

    let current;
    try {
      current = readAngelMd(mdPath);
    } catch (err: unknown) {
      throw new Error(
        `Failed to read angel.md for ${angel.id}: ${(err as Error).message}`,
        { cause: err },
      );
    }

    if (current.frontmatter.status === 'active') {
      console.log(`  ${angel.id}: already active, skipping.`);
      skipped++;
      continue;
    }

    writeAngelMd(mdPath, {
      frontmatter: {
        ...current.frontmatter,
        status: 'active',
        last_updated: new Date().toISOString(),
        last_updated_by: 'main',
      },
      body: current.body,
    });

    console.log(`  ${angel.id}: activated.`);
    activated++;
  }

  console.log('');
  console.log(`Activated ${activated} angel(s), skipped ${skipped}.`);
}
