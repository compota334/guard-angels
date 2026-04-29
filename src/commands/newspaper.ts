import { loadConfig } from '../config/load.js';
import { readNewspaperSince } from '../messaging/newspaper.js';

/**
 * Print recent newspaper entries.
 *
 * Validates the project is initialized (config exists). If --since is
 * provided, only entries with timestamps >= the given ISO timestamp are
 * printed. Without --since, all entries are printed.
 *
 * The newspaper is the global append-only event log. This command reads
 * it from disk and pretty-prints entries.
 */
export function showNewspaper(
  cwd: string,
  opts: { since?: string } = {},
): void {
  // Validate project is initialized (config must exist)
  loadConfig(cwd);

  // Read all entries from the beginning (cursor 0)
  const entries = readNewspaperSince(cwd, 0);

  if (entries.length === 0) {
    console.log('No newspaper entries.');
    return;
  }

  // Filter by --since if provided
  let filtered = entries;
  if (opts.since) {
    // Validate the timestamp is parseable
    const sinceDate = new Date(opts.since);
    if (isNaN(sinceDate.getTime())) {
      throw new Error(
        `Invalid --since timestamp: "${opts.since}". Provide a valid ISO 8601 timestamp (e.g. 2026-04-28T14:00:00Z).`,
      );
    }

    const sinceIso = opts.since;
    filtered = entries.filter((e) => e.timestamp >= sinceIso);
  }

  if (filtered.length === 0) {
    console.log(
      opts.since
        ? `No newspaper entries since ${opts.since}.`
        : 'No newspaper entries.',
    );
    return;
  }

  console.log(`Newspaper entries (${filtered.length}):`);
  console.log('');

  for (const entry of filtered) {
    console.log(`## ${entry.timestamp} [${entry.angelId}]`);
    if (entry.body) {
      for (const line of entry.body.split('\n')) {
        console.log(line);
      }
    }
    console.log('');
  }
}
