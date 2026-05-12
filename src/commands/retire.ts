import * as fs from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readInbox } from '../messaging/cables.js';
import {
  configFile,
  archiveDir,
  angelMdFile,
  angelBriefsDir,
  angelResponsesDir,
  angelLogsDir,
  angelInboxDir,
} from '../paths/layout.js';

/**
 * Retire an angel: archive its angel.md, remove it from config, clean up
 * per-angel directories. Refuses if cables are pending in the inbox or if
 * the target is _root.
 */
export async function retireAngel(cwd: string, angelId: string): Promise<number> {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);

  if (angelId === '_root') {
    throw new Error('Cannot retire the _root angel.');
  }

  // Validate angel exists (throws if not found)
  const angel = registry.getById(angelId);

  // Refuse if cables are pending in inbox
  const pendingCables = readInbox(cwd, angelId);
  if (pendingCables.length > 0) {
    throw new Error(
      `Cannot retire "${angelId}": ${pendingCables.length} cable(s) pending in inbox. Process them first with "angels sweep --angel ${angelId}".`,
    );
  }

  // Warn if other angels reference this angel by ID in their angel.md
  const otherAngels = registry.listAll().filter((a) => a.id !== angelId);
  const referencedIn: string[] = [];
  for (const other of otherAngels) {
    const otherAngelPath = other.type === 'root' ? '_root' : other.path;
    const mdPath = angelMdFile(cwd, otherAngelPath);
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, 'utf-8');
      if (content.includes(angelId)) {
        referencedIn.push(other.id);
      }
    }
  }
  if (referencedIn.length > 0) {
    console.warn(`Warning: "${angelId}" is referenced in these angel.md files:`);
    for (const ref of referencedIn) {
      console.warn(`  - ${ref}`);
    }
    console.warn('Update those files after retiring to keep them accurate.');
    console.warn('');
  }

  // Archive angel.md
  const angelPath = angel.type === 'root' ? '_root' : angel.path;
  const mdSrc = angelMdFile(cwd, angelPath);
  const archiveDest = join(archiveDir(cwd), angelId);
  fs.mkdirSync(archiveDest, { recursive: true });
  if (fs.existsSync(mdSrc)) {
    fs.renameSync(mdSrc, join(archiveDest, 'angel.md'));
    console.log(`Archived: ${mdSrc} -> ${join(archiveDest, 'angel.md')}`);
  }

  // Clean up per-angel directories
  const dirsToClean = [
    angelBriefsDir(cwd, angelId),
    angelResponsesDir(cwd, angelId),
    angelLogsDir(cwd, angelId),
    angelInboxDir(cwd, angelId),
  ];
  for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      console.log(`Removed: ${dir}`);
    }
  }

  // Remove from _config.yml
  const updatedConfig = {
    ...config,
    angels: config.angels.filter((a) => a.id !== angelId),
  };
  const cfgPath = configFile(cwd);
  fs.writeFileSync(cfgPath, stringifyYaml(updatedConfig, { lineWidth: 0 }), 'utf-8');
  console.log(`Removed "${angelId}" from _config.yml`);

  console.log(`\nAngel "${angelId}" retired.`);
  return 0;
}
