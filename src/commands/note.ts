import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { angelIdToPath } from '../paths/resolve.js';
import { appendJournal } from '../angels/journal.js';

/**
 * Append a human note to an angel's journal (## Journal in angel.md).
 * Deterministic, no AI invocation; the angel folds it into its curated
 * memory during the next sweep.
 */
export function noteAngel(cwd: string, angelId: string, text: string): void {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  if (!text.trim()) {
    throw new Error('Note text must not be empty.');
  }

  appendJournal(cwd, angelId, angelIdToPath(angelId), [`note: ${text.trim()}`]);
  console.log(`Journal note appended to ${angelId}'s angel.md.`);
}
