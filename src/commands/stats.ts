import * as fs from 'node:fs';
import { join, relative } from 'node:path';
import * as z from 'zod';
import { execa } from 'execa';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import {
  angelLogsDir,
  angelResponsesDir,
  angelMdFile,
  archiveDir,
} from '../paths/layout.js';
import { readAngelMd } from '../angels/memory.js';
import { parseResponseContent, type ResponseVerdict } from '../protocol/response.js';

/**
 * `angels stats`: aggregate per-angel metrics from the artifacts the republic
 * already produces. Read-only; nothing under .angels/ is modified.
 *
 * Data sources:
 * - Invocations, tokens, cost: `_logs/<id>/*.meta.json` (plus the copies
 *   housekeeping moved under `_archive/<YYYY-MM>/_logs/<id>/`). Usage and
 *   cost exist only for claude-backend invocations from 0.3 onward; their
 *   absence is reported as absence, never as zero.
 * - Verdicts: response JSONs in `_responses/<id>/` and
 *   `_archive/<YYYY-MM>/_responses/<id>/`. Responses are the structured
 *   source of truth for verdicts; the newspaper is prose and not parsed here.
 * - Staleness: angel.md frontmatter `last_updated` (which journal appends
 *   deliberately do not touch, so it means "last curated update") against
 *   `git log -1 --format=%cI -- <territory>`.
 *
 * The `AngelStats` / `StatsReport` shapes are consumed by later interfaces
 * (MCP tools, reputation metrics); treat field renames as breaking.
 */

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface VerdictCounts {
  proceed: number;
  concerns: number;
  refuse: number;
  done: number;
  error: number;
}

export interface AngelStats {
  id: string;
  type: 'root' | 'folder';
  path: string;
  invocations: {
    total: number;
    byPhase: Record<string, number>;
    timedOut: number;
    spawnErrors: number;
    /** Invocations whose meta carries token usage (claude backend, 0.3+). */
    withUsage: number;
  };
  /** Summed usage across invocations that reported it; null when none did. */
  tokens: TokenTotals | null;
  /** Summed cost across invocations that reported it; null when none did. */
  costUsd: number | null;
  verdicts: VerdictCounts;
  /** Refuse verdicts whose concerns cite at least one INV-NNN id. */
  refusalsCitingInvariants: number;
  responsesParsed: number;
  memory: {
    /** Frontmatter last_updated; null when angel.md is missing or invalid. */
    lastCurated: string | null;
    /** ISO date of the last commit touching the territory; null when git has none. */
    territoryLastCommit: string | null;
    /** Whole days the territory's last commit is ahead of the curated memory. */
    staleDays: number | null;
  };
}

export interface StatsReport {
  since: string | null;
  angels: AngelStats[];
  totals: {
    invocations: number;
    tokens: TokenTotals | null;
    costUsd: number | null;
    verdicts: VerdictCounts;
    refusalsCitingInvariants: number;
  };
  /**
   * Announced anomalies (skipped malformed files, git unavailability).
   * Printed by the CLI; a non-empty list never fails the command because
   * stats aggregates historical artifacts it does not own.
   */
  warnings: string[];
}

/**
 * Lenient view of a `.meta.json` file. Pre-0.3 metas lack usage/cost/session
 * fields entirely; unknown extra fields are ignored.
 */
const MetaFileSchema = z.object({
  phase: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheCreationInputTokens: z.number(),
      cacheReadInputTokens: z.number(),
    })
    .optional(),
  costUsd: z.number().optional(),
  startedAt: z.string().optional(),
  timedOut: z.boolean().optional(),
  spawnError: z.boolean().optional(),
});

const INVARIANT_ID_PATTERN = /\bINV-\d+\b/;

const ARCHIVE_MONTH_PATTERN = /^\d{4}-\d{2}$/;

/**
 * List archive month directories (`_archive/<YYYY-MM>/`), oldest first.
 */
function archiveMonthDirs(projectRoot: string): string[] {
  const archive = archiveDir(projectRoot);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(archive, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && ARCHIVE_MONTH_PATTERN.test(e.name))
    .map((e) => join(archive, e.name))
    .sort();
}

/**
 * Collect files with the given suffix from a live per-angel directory plus
 * every archived copy of it (housekeeping preserves relative paths, so the
 * archived layout mirrors the live one).
 */
function collectAngelFiles(
  projectRoot: string,
  liveDir: string,
  topName: '_logs' | '_responses',
  angelId: string,
  suffix: string,
): string[] {
  const dirs = [
    liveDir,
    ...archiveMonthDirs(projectRoot).map((m) => join(m, topName, angelId)),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

function emptyVerdicts(): VerdictCounts {
  return { proceed: 0, concerns: 0, refuse: 0, done: 0, error: 0 };
}

function addTokens(target: TokenTotals, usage: TokenTotals): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  target.cacheReadInputTokens += usage.cacheReadInputTokens;
}

/**
 * Last commit touching the territory, as an ISO timestamp.
 * Returns null when no commit touches the path.
 * Throws with git's own message when git itself fails (not a repository,
 * git missing); the caller downgrades that to a single announced warning
 * because staleness is a metric, not a precondition for the other stats.
 */
async function territoryLastCommit(
  projectRoot: string,
  territoryPath: string,
): Promise<string | null> {
  const result = await execa(
    'git',
    ['log', '-1', '--format=%cI', '--', territoryPath],
    { cwd: projectRoot, reject: false },
  );
  if (result.exitCode !== 0 || result.failed) {
    const detail = (result.stderr || 'git exited non-zero').split('\n')[0];
    throw new Error(`git log failed: ${detail}`);
  }
  const iso = result.stdout.trim();
  return iso === '' ? null : iso;
}

function computeStaleDays(
  lastCurated: string | null,
  lastCommit: string | null,
): number | null {
  if (lastCurated === null || lastCommit === null) return null;
  const curatedMs = Date.parse(lastCurated);
  const commitMs = Date.parse(lastCommit);
  if (isNaN(curatedMs) || isNaN(commitMs)) return null;
  if (commitMs <= curatedMs) return 0;
  return Math.floor((commitMs - curatedMs) / (24 * 60 * 60 * 1000));
}

export interface CollectStatsOptions {
  /** Only count invocations and responses timestamped at or after this ISO instant. */
  since?: string;
}

export async function collectStats(
  projectRoot: string,
  opts: CollectStatsOptions = {},
): Promise<StatsReport> {
  let sinceMs: number | null = null;
  if (opts.since !== undefined) {
    sinceMs = Date.parse(opts.since);
    if (isNaN(sinceMs)) {
      throw new Error(
        `Invalid --since value: "${opts.since}". Expected an ISO timestamp (e.g. 2026-07-01 or 2026-07-01T12:00:00Z).`,
      );
    }
  }

  const config = loadConfig(projectRoot);
  const registry = AngelRegistry.fromConfig(config);
  const warnings: string[] = [];

  // git availability is probed once; after the first hard failure staleness
  // is skipped for every angel with a single announced warning.
  let gitAvailable = true;

  const angels: AngelStats[] = [];

  for (const angel of registry.listAll()) {
    const stats: AngelStats = {
      id: angel.id,
      type: angel.type,
      path: angel.path,
      invocations: { total: 0, byPhase: {}, timedOut: 0, spawnErrors: 0, withUsage: 0 },
      tokens: null,
      costUsd: null,
      verdicts: emptyVerdicts(),
      refusalsCitingInvariants: 0,
      responsesParsed: 0,
      memory: { lastCurated: null, territoryLastCommit: null, staleDays: null },
    };

    // --- Invocations from .meta.json files ---
    const metaFiles = collectAngelFiles(
      projectRoot,
      angelLogsDir(projectRoot, angel.id),
      '_logs',
      angel.id,
      '.meta.json',
    );
    for (const file of metaFiles) {
      let meta: z.infer<typeof MetaFileSchema>;
      try {
        meta = MetaFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
      } catch (err: unknown) {
        warnings.push(
          `Skipped malformed meta file ${relative(projectRoot, file)}: ${(err as Error).message.split('\n')[0]}`,
        );
        continue;
      }
      if (sinceMs !== null) {
        const startedMs = meta.startedAt !== undefined ? Date.parse(meta.startedAt) : NaN;
        if (isNaN(startedMs)) {
          warnings.push(
            `Skipped meta file without a parseable startedAt while filtering by --since: ${relative(projectRoot, file)}`,
          );
          continue;
        }
        if (startedMs < sinceMs) continue;
      }
      stats.invocations.total += 1;
      const phase = meta.phase ?? 'unknown';
      stats.invocations.byPhase[phase] = (stats.invocations.byPhase[phase] ?? 0) + 1;
      if (meta.timedOut === true) stats.invocations.timedOut += 1;
      if (meta.spawnError === true) stats.invocations.spawnErrors += 1;
      if (meta.usage !== undefined) {
        stats.invocations.withUsage += 1;
        stats.tokens ??= {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        };
        addTokens(stats.tokens, meta.usage);
      }
      if (meta.costUsd !== undefined) {
        stats.costUsd = (stats.costUsd ?? 0) + meta.costUsd;
      }
    }

    // --- Verdicts from response JSONs ---
    const responseFiles = collectAngelFiles(
      projectRoot,
      angelResponsesDir(projectRoot, angel.id),
      '_responses',
      angel.id,
      '.json',
    );
    for (const file of responseFiles) {
      let verdict: ResponseVerdict;
      let concerns: string;
      let timestamp: string;
      try {
        const data = parseResponseContent(fs.readFileSync(file, 'utf-8'));
        verdict = data.response;
        concerns = data.concerns;
        timestamp = data.timestamp;
      } catch (err: unknown) {
        warnings.push(
          `Skipped malformed response file ${relative(projectRoot, file)}: ${(err as Error).message.split('\n')[0]}`,
        );
        continue;
      }
      if (sinceMs !== null) {
        const tsMs = Date.parse(timestamp);
        if (isNaN(tsMs) || tsMs < sinceMs) continue;
      }
      stats.responsesParsed += 1;
      stats.verdicts[verdict] += 1;
      if (verdict === 'refuse' && INVARIANT_ID_PATTERN.test(concerns)) {
        stats.refusalsCitingInvariants += 1;
      }
    }

    // --- Memory freshness ---
    try {
      const md = readAngelMd(angelMdFile(projectRoot, angel.path));
      stats.memory.lastCurated = md.frontmatter.last_updated;
    } catch {
      // Missing or invalid angel.md: freshness is simply unknown for this
      // angel; `angels doctor` is the command that diagnoses memory health.
    }
    if (gitAvailable) {
      try {
        stats.memory.territoryLastCommit = await territoryLastCommit(
          projectRoot,
          angel.path,
        );
      } catch (err: unknown) {
        gitAvailable = false;
        warnings.push(
          `Staleness not computed: ${(err as Error).message}`,
        );
      }
    }
    stats.memory.staleDays = computeStaleDays(
      stats.memory.lastCurated,
      stats.memory.territoryLastCommit,
    );

    angels.push(stats);
  }

  // --- Totals ---
  const totals: StatsReport['totals'] = {
    invocations: 0,
    tokens: null,
    costUsd: null,
    verdicts: emptyVerdicts(),
    refusalsCitingInvariants: 0,
  };
  for (const a of angels) {
    totals.invocations += a.invocations.total;
    if (a.tokens !== null) {
      totals.tokens ??= {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      };
      addTokens(totals.tokens, a.tokens);
    }
    if (a.costUsd !== null) {
      totals.costUsd = (totals.costUsd ?? 0) + a.costUsd;
    }
    for (const key of Object.keys(totals.verdicts) as (keyof VerdictCounts)[]) {
      totals.verdicts[key] += a.verdicts[key];
    }
    totals.refusalsCitingInvariants += a.refusalsCitingInvariants;
  }

  return { since: opts.since ?? null, angels, totals, warnings };
}

// --- CLI printer ---

type Alignment = 'left' | 'right';

function renderTable(
  headers: string[],
  alignments: Alignment[],
  rows: string[][],
): string[] {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );
  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, i) =>
        alignments[i] === 'right' ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!),
      )
      .join('  ')
      .trimEnd();
  return [
    formatRow(headers),
    formatRow(widths.map((w) => '─'.repeat(w))),
    ...rows.map(formatRow),
  ];
}

function formatCount(n: number): string {
  return String(n);
}

function formatTokens(n: number | undefined): string {
  return n === undefined ? '-' : n.toLocaleString('en-US');
}

function formatCost(costUsd: number | null): string {
  return costUsd === null ? '-' : `$${costUsd.toFixed(4)}`;
}

function formatDate(iso: string | null): string {
  if (iso === null) return '-';
  const ms = Date.parse(iso);
  return isNaN(ms) ? iso : new Date(ms).toISOString().slice(0, 10);
}

function formatStale(days: number | null): string {
  return days === null ? '-' : `${days}d`;
}

export interface ShowStatsOptions {
  json?: boolean;
  since?: string;
}

export async function showStats(
  cwd: string,
  opts: ShowStatsOptions = {},
): Promise<void> {
  const report = await collectStats(cwd, { since: opts.since });

  if (opts.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.since !== null) {
    console.log(`Stats since ${report.since}`);
    console.log('');
  }

  // Activity and cost
  const activityHeaders = [
    'ANGEL', 'INVOC', 'PROCEED', 'CONCERNS', 'REFUSE', 'REF-INV',
    'DONE', 'ERROR', 'IN-TOK', 'OUT-TOK', 'CACHE-RD', 'COST',
  ];
  const activityAlignments: Alignment[] = [
    'left', 'right', 'right', 'right', 'right', 'right',
    'right', 'right', 'right', 'right', 'right', 'right',
  ];
  const activityRow = (
    label: string,
    invocations: number,
    verdicts: VerdictCounts,
    refInv: number,
    tokens: TokenTotals | null,
    costUsd: number | null,
  ): string[] => [
    label,
    formatCount(invocations),
    formatCount(verdicts.proceed),
    formatCount(verdicts.concerns),
    formatCount(verdicts.refuse),
    formatCount(refInv),
    formatCount(verdicts.done),
    formatCount(verdicts.error),
    formatTokens(tokens?.inputTokens),
    formatTokens(tokens?.outputTokens),
    formatTokens(tokens?.cacheReadInputTokens),
    formatCost(costUsd),
  ];
  const activityRows = report.angels.map((a) =>
    activityRow(a.id, a.invocations.total, a.verdicts, a.refusalsCitingInvariants, a.tokens, a.costUsd),
  );
  activityRows.push(
    activityRow(
      'TOTAL',
      report.totals.invocations,
      report.totals.verdicts,
      report.totals.refusalsCitingInvariants,
      report.totals.tokens,
      report.totals.costUsd,
    ),
  );
  for (const line of renderTable(activityHeaders, activityAlignments, activityRows)) {
    console.log(line);
  }

  // Memory freshness
  console.log('');
  const freshnessHeaders = ['ANGEL', 'LAST CURATED', 'TERRITORY COMMIT', 'STALE'];
  const freshnessAlignments: Alignment[] = ['left', 'left', 'left', 'right'];
  const freshnessRows = report.angels.map((a) => [
    a.id,
    formatDate(a.memory.lastCurated),
    formatDate(a.memory.territoryLastCommit),
    formatStale(a.memory.staleDays),
  ]);
  for (const line of renderTable(freshnessHeaders, freshnessAlignments, freshnessRows)) {
    console.log(line);
  }

  // Announced gaps: absence of usage is reported, never faked as zero.
  const withoutUsage = report.angels.reduce(
    (sum, a) => sum + (a.invocations.total - a.invocations.withUsage),
    0,
  );
  const notes: string[] = [];
  if (withoutUsage > 0) {
    notes.push(
      `${withoutUsage} invocation(s) carry no token usage (non-claude backend or pre-0.3 logs); token and cost columns cover only the rest.`,
    );
  }
  notes.push(...report.warnings);
  if (notes.length > 0) {
    console.log('');
    for (const note of notes) {
      console.log(`Note: ${note}`);
    }
  }
}
