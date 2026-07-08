import * as fs from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execa } from 'execa';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief, parseBrief } from '../protocol/brief.js';
import { invoke } from '../protocol/orchestrate.js';
import { angelIdToPath } from '../paths/resolve.js';
import { angelLogsDir } from '../paths/layout.js';
import { appendNewspaper } from '../messaging/newspaper.js';
import { archiveProcessedInbox } from '../messaging/cables.js';
import { handleQuestionsForMain } from '../messaging/questions.js';
import type { ResponseData } from '../protocol/response.js';
import type { CheckEntry } from '../config/schema.js';

/**
 * A snapshot entry for a single file: modification time + size.
 */
interface FileSnapshot {
  mtimeMs: number;
  size: number;
}

export interface ExecuteOptions {
  /** Tri-state: undefined = use config `execute.strict_territory` (default true). */
  strictTerritory?: boolean;
}

/**
 * Run phase 2 (EXECUTE) for an angel: re-invoke the angel with the
 * original brief + approval flag, detect territory violations, and
 * append a newspaper entry.
 *
 * Returns the exit code (0 = done, 1 = error).
 * With strictTerritory=true, out-of-territory writes are blocking: new files
 * outside territory are deleted (rollback) and the command exits with code 1.
 */
export async function executeAngel(
  cwd: string,
  angelId: string,
  briefPath: string,
  options: ExecuteOptions = {},
): Promise<number> {
  // 1. Load config and validate angel exists
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  const angel = registry.getById(angelId); // throws if not found

  // Strict territory: CLI flag wins; otherwise config (default: strict).
  const strictTerritory = options.strictTerritory ?? config.execute.strict_territory;

  // 2. Parse the original brief to extract the task
  let originalBrief;
  try {
    originalBrief = parseBrief(briefPath);
  } catch (err: unknown) {
    throw new Error(
      `Failed to parse brief file "${briefPath}": ${(err as Error).message}`,
      { cause: err },
    );
  }

  // 3. Compute the angel's territory (absolute path)
  const angelPath = angelIdToPath(angelId);
  const territoryAbsPath = resolve(cwd, angelPath);

  // 4. Snapshot the project tree BEFORE invocation
  const beforeSnapshot = snapshotProjectTree(cwd);

  // 5. Write the execute-phase brief (references the original review brief)
  const timestamp = new Date().toISOString();
  const executeBriefPath = writeBrief(cwd, {
    to: angelId,
    from: 'main',
    timestamp,
    phase: 'execute',
    type: originalBrief.type,
    task: originalBrief.task,
    context: 'APPROVED: Execute the changes described in the original brief.',
    expectedScope: originalBrief.expectedScope,
    priorResponse: briefPath,
  });

  console.log(`Execute brief written to: ${executeBriefPath}`);

  // 6. Invoke the orchestrator in execute mode
  const result = await invoke(cwd, {
    phase: 'execute',
    angelId,
    briefPath: executeBriefPath,
  });

  // 7. Snapshot the project tree AFTER invocation
  const afterSnapshot = snapshotProjectTree(cwd);

  // 8. Detect territory violations
  const changedFiles = detectChangedFiles(beforeSnapshot, afterSnapshot);
  const outOfTerritoryAdded = findOutOfTerritoryWrites(
    changedFiles.added,
    cwd,
    territoryAbsPath,
    angelPath,
  );
  const outOfTerritoryModified = findOutOfTerritoryWrites(
    changedFiles.modified,
    cwd,
    territoryAbsPath,
    angelPath,
  );
  const outOfTerritory = [...outOfTerritoryAdded, ...outOfTerritoryModified];

  // 8a. Strict territory: rollback new files and fail
  if (strictTerritory && outOfTerritory.length > 0) {
    const rolledBack = rollbackAddedFiles(cwd, outOfTerritoryAdded);
    appendNewspaperEntry(cwd, angelId, result.response, outOfTerritory, true, []);
    printStrictTerritoryViolation(
      outOfTerritoryAdded,
      outOfTerritoryModified,
      rolledBack,
      result.responsePath,
    );
    return 1;
  }

  // 8b. Proof-of-done checks: a done verdict only counts once the territory's
  // configured checks pass. Output is captured to _logs/ as evidence.
  let checkResults: CheckResult[] = [];
  if (result.response.response === 'done' && (angel.checks?.length ?? 0) > 0) {
    const checks = angel.checks as CheckEntry[];
    console.log('');
    console.log(`Running ${checks.length} proof-of-done check(s)...`);
    checkResults = await runChecks(cwd, checks, config.checks_timeout_seconds);
    const checksLogPath = writeChecksLog(cwd, angelId, timestamp, checkResults);

    for (const check of checkResults) {
      const status = check.passed ? 'PASS' : `FAIL (exit ${check.exitCode})`;
      console.log(`  ${status}  ${check.name}: ${check.cmd}`);
    }
    console.log(`  Check output: ${checksLogPath}`);

    const failed = checkResults.filter((c) => !c.passed);
    if (failed.length > 0) {
      appendNewspaperEntry(cwd, angelId, result.response, outOfTerritory, false, checkResults);
      printChecksFailure(failed, checksLogPath, result.responsePath);
      return 1;
    }
  }

  // 9. Archive inbox cables the angel saw during execution
  if (result.response.response === 'done') {
    archiveProcessedInbox(cwd, angelId);
  }

  // 9b. Route questions back to main's inbox if the angel raised any
  if (result.response.questionsForMain.trim()) {
    handleQuestionsForMain(cwd, angelId, result.response.questionsForMain);
  }

  // 10. Append newspaper entry
  appendNewspaperEntry(cwd, angelId, result.response, outOfTerritory, false, checkResults);

  // 11. Print summary
  printExecuteSummary(result.response, result.responsePath, outOfTerritory);

  // 12. Return exit code
  if (result.response.response === 'done') {
    return 0;
  }
  return 1;
}

/**
 * Delete newly-created files that are outside the angel's territory.
 * Returns the list of files that were successfully deleted.
 * Files that cannot be deleted (permissions, etc.) are skipped but still listed.
 */
function rollbackAddedFiles(projectRoot: string, files: string[]): string[] {
  const rolledBack: string[] = [];
  for (const relPath of files) {
    const absPath = resolve(projectRoot, relPath);
    try {
      fs.unlinkSync(absPath);
      rolledBack.push(relPath);
    } catch {
      // Best-effort: log failure but keep going
    }
  }
  return rolledBack;
}

/**
 * Print a blocking territory violation message (--strict-territory mode).
 */
function printStrictTerritoryViolation(
  addedViolations: string[],
  modifiedViolations: string[],
  rolledBack: string[],
  responsePath: string,
): void {
  console.error('');
  console.error('ERROR: Out-of-territory writes detected (--strict-territory is active).');
  console.error('');

  if (addedViolations.length > 0) {
    console.error('New files written outside territory:');
    for (const f of addedViolations) {
      const status = rolledBack.includes(f) ? '(deleted - rolled back)' : '(could not delete)';
      console.error(`  - ${f} ${status}`);
    }
    console.error('');
  }

  if (modifiedViolations.length > 0) {
    console.error('Modified files outside territory (cannot auto-restore):');
    for (const f of modifiedViolations) {
      console.error(`  - ${f}`);
    }
    console.error('');
  }

  console.error(`Response file: ${responsePath}`);
}

/**
 * Walk the project tree and create a Map of relative-path -> { mtimeMs, size }.
 * Skips .angels/, node_modules/, .git/, dist/.
 */
function snapshotProjectTree(projectRoot: string): Map<string, FileSnapshot> {
  const snapshot = new Map<string, FileSnapshot>();
  walkDir(projectRoot, projectRoot, snapshot);
  return snapshot;
}

const SKIP_DIRS = new Set([
  '.angels',
  'node_modules',
  '.git',
  'dist',
]);

function walkDir(
  dir: string,
  projectRoot: string,
  snapshot: Map<string, FileSnapshot>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(projectRoot, fullPath);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      walkDir(fullPath, projectRoot, snapshot);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // For symlinks, statSync follows the link and returns the target's
      // metadata — that's what we want, because a write to the target
      // changes its mtime/size, and we capture the change here.
      // Symlinked directories are intentionally NOT recursed into to avoid
      // infinite loops; symlinks pointing to non-files are simply skipped
      // by the !isFile() guard below.
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        // Dangling symlink, or file deleted between readdir and stat.
        // Either way, there's nothing to snapshot.
        continue;
      }
      if (!stat.isFile()) continue;
      snapshot.set(relPath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
}

interface ChangedFiles {
  added: string[];
  modified: string[];
}

/**
 * Compare before and after snapshots to find files that were added or modified.
 * Returns separate lists for newly created files and modified existing files.
 */
function detectChangedFiles(
  before: Map<string, FileSnapshot>,
  after: Map<string, FileSnapshot>,
): ChangedFiles {
  const added: string[] = [];
  const modified: string[] = [];

  for (const [path, afterEntry] of after) {
    const beforeEntry = before.get(path);
    if (!beforeEntry) {
      added.push(path);
    } else if (
      beforeEntry.mtimeMs !== afterEntry.mtimeMs ||
      beforeEntry.size !== afterEntry.size
    ) {
      modified.push(path);
    }
  }

  return { added, modified };
}

/**
 * Given a list of changed files (relative paths), identify which ones
 * are outside the angel's territory.
 *
 * Each changed file is resolved through realpath so that symlinks pointing
 * outside the territory are correctly flagged: a write through an
 * in-territory symlink whose target lives elsewhere is an out-of-territory
 * write, and we surface it.
 *
 * The in-territory check uses `path.relative` rather than string-prefix
 * comparison: a non-empty relative path that starts with `..` (or equals
 * `..`) means the file lies outside the territory directory.
 *
 * For root angel (angelPath === '.'), everything is in territory.
 */
function findOutOfTerritoryWrites(
  changedFiles: string[],
  projectRoot: string,
  territoryAbsPath: string,
  angelPath: string,
): string[] {
  // Root angel owns everything
  if (angelPath === '.') {
    return [];
  }

  // Resolve the territory path itself through realpath in case the territory
  // directory is itself reached via a symlink (uncommon but possible).
  let territoryReal: string;
  try {
    territoryReal = fs.realpathSync(territoryAbsPath);
  } catch {
    territoryReal = territoryAbsPath;
  }

  const outOfTerritory: string[] = [];
  for (const relPath of changedFiles) {
    const absPath = resolve(projectRoot, relPath);
    let realAbsPath: string;
    try {
      realAbsPath = fs.realpathSync(absPath);
    } catch {
      // Realpath can fail for files that were moved/deleted between
      // snapshot and check. Fall back to the unresolved path; the user
      // can investigate via the newspaper warning.
      realAbsPath = absPath;
    }

    // path.relative emits "" when the paths are equal, ".." or "../foo"
    // (or backslash variants on Windows) when realAbsPath lies outside
    // territoryReal, and a non-".." relative path when it lies inside.
    const rel = relative(territoryReal, realAbsPath);
    const inTerritory = rel === '' || !rel.startsWith('..');
    if (!inTerritory) {
      outOfTerritory.push(relPath);
    }
  }

  return outOfTerritory;
}

/**
 * Append a newspaper entry for the execute action.
 * If there are out-of-territory writes, add a warning.
 * strictViolation=true means the execute was blocked by --strict-territory.
 */
function appendNewspaperEntry(
  projectRoot: string,
  angelId: string,
  response: ResponseData,
  outOfTerritory: string[],
  strictViolation: boolean,
  checkResults: CheckResult[],
): void {
  const timestamp = new Date().toISOString();

  let summary: string;
  const detailLines: string[] = [];

  if (response.response === 'done') {
    summary = 'EXECUTE completed successfully.';
    if (response.filesChanged.length > 0) {
      detailLines.push(`Files changed: ${response.filesChanged.join(', ')}`);
    }
    if (response.angelMdUpdated) {
      detailLines.push('angel.md was updated.');
    }
  } else {
    summary = `EXECUTE finished with RESPONSE: ${response.response}`;
    if (response.concerns) {
      detailLines.push(`Concerns: ${response.concerns}`);
    }
  }

  if (outOfTerritory.length > 0) {
    const label = strictViolation
      ? 'ERROR: Out-of-territory writes blocked (--strict-territory):'
      : 'WARNING: Out-of-territory writes detected:';
    detailLines.push(label);
    for (const file of outOfTerritory) {
      detailLines.push(`  - ${file}`);
    }
  }

  if (strictViolation) {
    summary = `EXECUTE blocked by --strict-territory: out-of-territory writes detected.`;
  }

  const failedChecks = checkResults.filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    summary = 'EXECUTE failed proof-of-done checks.';
    detailLines.push(
      `Checks FAILED: ${failedChecks.map((c) => `${c.name} (exit ${c.exitCode})`).join(', ')}`,
    );
  } else if (checkResults.length > 0) {
    detailLines.push(`Checks: ${checkResults.length} passed`);
  }

  appendNewspaper(projectRoot, {
    timestamp,
    angelId,
    summary,
    details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
  });
}

// ─── Proof-of-done checks ─────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  cmd: string;
  exitCode: number;
  output: string;
  passed: boolean;
}

/**
 * Run the territory's proof-of-done checks sequentially in the project root.
 * A check passes iff its command exits 0 within the timeout.
 */
async function runChecks(
  projectRoot: string,
  checks: CheckEntry[],
  timeoutSeconds: number,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await execa(check.cmd, {
      shell: true,
      cwd: projectRoot,
      timeout: timeoutSeconds * 1000,
      reject: false,
      all: true,
    });
    const timedOut = result.timedOut === true;
    const exitCode = result.exitCode ?? (timedOut ? 124 : 1);
    results.push({
      name: check.name,
      cmd: check.cmd,
      exitCode,
      output: timedOut
        ? `${result.all ?? ''}\n[check timed out after ${timeoutSeconds}s]`
        : (result.all ?? ''),
      passed: exitCode === 0,
    });
  }
  return results;
}

/**
 * Write the raw output of every check to _logs/<angel-id>/<ts>-checks.log
 * so the evidence survives next to the invocation logs.
 */
function writeChecksLog(
  projectRoot: string,
  angelId: string,
  isoTimestamp: string,
  results: CheckResult[],
): string {
  const dir = angelLogsDir(projectRoot, angelId);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${isoTimestamp.replace(/:/g, '-')}-checks.log`);

  const sections = results.map((r) =>
    [`=== check: ${r.name} (${r.cmd}) exit=${r.exitCode} ===`, r.output, ''].join('\n'),
  );
  fs.writeFileSync(logPath, sections.join('\n'), 'utf-8');
  return logPath;
}

/**
 * Print a blocking failure message when proof-of-done checks fail.
 * Shows the tail of each failing check's output.
 */
function printChecksFailure(
  failed: CheckResult[],
  checksLogPath: string,
  responsePath: string,
): void {
  console.error('');
  console.error('ERROR: EXECUTE failed proof-of-done checks. The angel reported done,');
  console.error('but the territory checks did not pass. Changes were NOT rolled back.');
  console.error('');

  for (const check of failed) {
    console.error(`FAILED: ${check.name} (${check.cmd}) — exit ${check.exitCode}`);
    const tail = check.output.trim().split('\n').slice(-20);
    for (const line of tail) {
      console.error(`  ${line}`);
    }
    console.error('');
  }

  console.error(`Full check output: ${checksLogPath}`);
  console.error(`Response file: ${responsePath}`);
}

/**
 * Print a human-readable summary of the execute result.
 */
function printExecuteSummary(
  response: ResponseData,
  responsePath: string,
  outOfTerritory: string[],
): void {
  const verdict = response.response.toUpperCase();

  console.log('');
  console.log(`=== Execute Result: ${verdict} ===`);
  console.log('');

  if (response.response === 'done') {
    if (response.filesChanged.length > 0) {
      console.log('FILES CHANGED:');
      console.log(`  ${response.filesChanged.join(', ')}`);
      console.log('');
    }

    if (response.angelMdUpdated) {
      console.log('angel.md was updated.');
      console.log('');
    }

    if (response.cablesSent.length > 0) {
      console.log('CABLES SENT:');
      console.log(`  ${response.cablesSent.map((c) => `${c.to}: ${c.type}`).join(', ')}`);
      console.log('');
    }
  }

  if (response.concerns) {
    console.log('CONCERNS:');
    for (const line of response.concerns.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  if (response.testResults) {
    console.log('TEST RESULTS:');
    for (const line of response.testResults.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  if (outOfTerritory.length > 0) {
    console.log('WARNING: Out-of-territory writes detected:');
    for (const file of outOfTerritory) {
      console.log(`  - ${file}`);
    }
    console.log('');
  }

  console.log(`Response file: ${responsePath}`);
}
