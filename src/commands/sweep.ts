import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief } from '../protocol/brief.js';
import { invoke, OrchestrationError } from '../protocol/orchestrate.js';
import { readNewspaperSince, getNewspaperSize, appendNewspaper } from '../messaging/newspaper.js';
import { getCursor, setCursor } from '../messaging/cursors.js';
import { readInbox, archiveProcessedInbox } from '../messaging/cables.js';
import type { InboxEntry } from '../protocol/prompt.js';
import type { ResponseData } from '../protocol/response.js';

/**
 * Result of sweeping a single angel.
 */
interface AngelSweepResult {
  angelId: string;
  response: ResponseData;
  responsePath: string;
}

/**
 * Run a sweep across all registered angels.
 *
 * Each angel is invoked sequentially in sweep phase. The sweep reads
 * the angel's inbox, the newspaper delta since its last cursor, and
 * its folder. The angel reports drift and may update its own angel.md
 * or send cables.
 *
 * v1 is report-only — sweep never edits code.
 *
 * Returns exit code 0 on success, 1 if any angel reported an error.
 */
export async function sweepAngels(
  cwd: string,
  options: { since?: string; timeoutSeconds?: number; angel?: string } = {},
): Promise<number> {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);

  let allAngels: ReadonlyArray<{ id: string }>;
  if (options.angel !== undefined) {
    const entry = registry.getById(options.angel);
    allAngels = [entry];
  } else {
    allAngels = registry.listAll();
  }

  console.log(`Starting sweep for ${allAngels.length} angel(s)...`);
  console.log('');

  const results: AngelSweepResult[] = [];
  let hasError = false;

  const SWEEP_CONCURRENCY = 5;

  const sweepOne = async (angel: { id: string }): Promise<void> => {
    console.log(`--- Sweeping: ${angel.id} ---`);
    try {
      const result = await sweepSingleAngel(cwd, angel.id, options);
      results.push(result);
      if (result.response.response === 'error') {
        hasError = true;
      }
    } catch (err: unknown) {
      if (err instanceof OrchestrationError && err.kind === 'timeout') {
        console.error(`  Timeout: ${angel.id} did not respond in time. Skipping.`);
      } else {
        console.error(`  Error sweeping ${angel.id}: ${(err as Error).message}`);
      }
      hasError = true;
    }
    console.log('');
  };

  for (let i = 0; i < allAngels.length; i += SWEEP_CONCURRENCY) {
    await Promise.allSettled(allAngels.slice(i, i + SWEEP_CONCURRENCY).map(sweepOne));
  }

  // Print summary
  printSweepSummary(results);

  return hasError ? 1 : 0;
}

/**
 * Sweep a single angel: read its inbox, newspaper delta, invoke in
 * sweep phase, append the sweep result to the newspaper, and advance
 * the angel's cursor.
 */
async function sweepSingleAngel(
  cwd: string,
  angelId: string,
  options: { since?: string; timeoutSeconds?: number },
): Promise<AngelSweepResult> {
  // 1. Read the angel's newspaper cursor and compute the delta
  const cursor = getCursor(cwd, angelId);
  const newspaperDelta = computeNewspaperDelta(cwd, cursor, options.since);

  // 2. Read the angel's inbox and map to InboxEntry[]
  const cables = readInbox(cwd, angelId);
  const inbox: InboxEntry[] = cables.map((cable) => ({
    urgency: cable.urgency,
    subject: cable.subject,
    content: cable.rawContent,
  }));

  // Move processed inbox cables to outbox so they don't accumulate
  archiveProcessedInbox(cwd, angelId);

  // 3. Write a sweep brief
  const timestamp = new Date().toISOString();
  const briefPath = writeBrief(cwd, {
    to: angelId,
    from: 'main',
    timestamp,
    phase: 'sweep',
    type: 'sweep',
    task: 'Maintenance sweep: read inbox, review newspaper delta, scan your folder, report drift.',
    context: '',
    expectedScope: '',
    priorResponse: 'none',
  });

  // 4. Invoke the orchestrator in sweep mode
  const result = await invoke(cwd, {
    phase: 'sweep',
    angelId,
    briefPath,
    newspaperDelta,
    inbox,
    timeoutSeconds: options.timeoutSeconds,
  });

  // 5. Append a newspaper entry for this sweep
  appendSweepNewspaperEntry(cwd, angelId, result.response);

  // 6. Advance the angel's cursor — but ONLY if the angel actually consumed
  // the delta. On RESPONSE: error or RESPONSE: refuse the angel did not
  // successfully process the newspaper entries presented to it, so we leave
  // the cursor where it was; the next sweep will re-present the same delta
  // (along with this sweep's failure entry, which is informative).
  if (
    result.response.response === 'done' ||
    result.response.response === 'concerns'
  ) {
    const newCursor = getNewspaperSize(cwd);
    setCursor(cwd, angelId, newCursor);
  }

  // 7. Print per-angel result
  printAngelSweepResult(angelId, result.response);

  return {
    angelId,
    response: result.response,
    responsePath: result.responsePath,
  };
}

/**
 * Compute the newspaper delta text for the angel.
 *
 * If --since is provided and it looks like an ISO timestamp, filter
 * entries to only those after the given timestamp. Otherwise, use the
 * angel's cursor offset.
 */
function computeNewspaperDelta(
  cwd: string,
  cursor: number,
  since?: string,
): string {
  const entries = readNewspaperSince(cwd, cursor);

  if (since && entries.length > 0) {
    // Filter entries by timestamp (ISO string comparison)
    const filtered = entries.filter((e) => e.timestamp >= since);
    if (filtered.length === 0) {
      return '';
    }
    return filtered.map((e) => `## ${e.timestamp} [${e.angelId}]\n${e.body}`).join('\n\n');
  }

  if (entries.length === 0) {
    return '';
  }

  return entries.map((e) => `## ${e.timestamp} [${e.angelId}]\n${e.body}`).join('\n\n');
}

/**
 * Append a newspaper entry summarizing the sweep result for one angel.
 */
function appendSweepNewspaperEntry(
  cwd: string,
  angelId: string,
  response: ResponseData,
): void {
  const timestamp = new Date().toISOString();
  const detailLines: string[] = [];

  let summary: string;
  if (response.response === 'done') {
    summary = 'SWEEP completed.';
    if (response.angelMdUpdated === 'true') {
      detailLines.push('angel.md was updated.');
    }
    if (response.cablesSent && response.cablesSent !== 'none') {
      detailLines.push(`Cables sent: ${response.cablesSent}`);
    }
  } else if (response.response === 'concerns') {
    summary = 'SWEEP raised concerns.';
    if (response.concerns) {
      detailLines.push(`Concerns: ${response.concerns}`);
    }
  } else {
    summary = `SWEEP finished with RESPONSE: ${response.response}`;
    if (response.concerns) {
      detailLines.push(`Concerns: ${response.concerns}`);
    }
  }

  // Include drift report if present
  if (response.driftReport) {
    detailLines.push(`Drift report: ${response.driftReport}`);
  }

  appendNewspaper(cwd, {
    timestamp,
    angelId,
    summary,
    details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
  });
}

/**
 * Print a one-line result for a single angel's sweep.
 */
function printAngelSweepResult(
  angelId: string,
  response: ResponseData,
): void {
  const verdict = response.response.toUpperCase();
  console.log(`  Result: ${verdict}`);

  if (response.driftReport) {
    console.log('  DRIFT REPORT:');
    for (const line of response.driftReport.split('\n')) {
      if (line.trim()) {
        console.log(`    ${line}`);
      }
    }
  }

  if (response.concerns) {
    console.log('  CONCERNS:');
    for (const line of response.concerns.split('\n')) {
      if (line.trim()) {
        console.log(`    ${line}`);
      }
    }
  }

  if (response.response === 'done' && response.angelMdUpdated === 'true') {
    console.log('  angel.md was updated.');
  }

  if (
    response.response === 'done' &&
    response.cablesSent &&
    response.cablesSent !== 'none'
  ) {
    console.log(`  Cables sent: ${response.cablesSent}`);
  }
}

/**
 * Print a summary table of all angel sweep results.
 */
function printSweepSummary(results: AngelSweepResult[]): void {
  console.log('=== Sweep Summary ===');
  console.log('');

  if (results.length === 0) {
    console.log('No angels swept.');
    return;
  }

  // Calculate column widths
  const idWidth = Math.max(5, ...results.map((r) => r.angelId.length));
  const verdictWidth = 8;
  const driftWidth = 30;

  // Header
  const header = [
    'ID'.padEnd(idWidth),
    'VERDICT'.padEnd(verdictWidth),
    'DRIFT',
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length + driftWidth));

  // Rows
  for (const result of results) {
    const verdict = result.response.response.toUpperCase();
    const drift = result.response.driftReport
      ? result.response.driftReport.split('\n')[0].slice(0, driftWidth) +
        (result.response.driftReport.length > driftWidth ? '...' : '')
      : '-';

    const row = [
      result.angelId.padEnd(idWidth),
      verdict.padEnd(verdictWidth),
      drift,
    ].join('  ');
    console.log(row);
  }

  console.log('');
}
