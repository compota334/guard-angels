import * as fs from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief, parseBrief } from '../protocol/brief.js';
import { invoke } from '../protocol/orchestrate.js';
import { angelIdToPath } from '../paths/resolve.js';
import { appendNewspaper } from '../messaging/newspaper.js';
import type { ResponseData } from '../protocol/response.js';

/**
 * A snapshot entry for a single file: modification time + size.
 */
interface FileSnapshot {
  mtimeMs: number;
  size: number;
}

/**
 * Run phase 2 (EXECUTE) for an angel: re-invoke the angel with the
 * original brief + approval flag, detect territory violations, and
 * append a newspaper entry.
 *
 * Returns the exit code (0 = done, 1 = error).
 */
export async function executeAngel(
  cwd: string,
  angelId: string,
  briefPath: string,
): Promise<number> {
  // 1. Load config and validate angel exists
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  // 2. Parse the original brief to extract the task
  const originalBrief = parseBrief(briefPath);

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
  const outOfTerritory = findOutOfTerritoryWrites(
    changedFiles,
    cwd,
    territoryAbsPath,
    angelPath,
  );

  // 9. Append newspaper entry
  appendNewspaperEntry(cwd, angelId, result.response, outOfTerritory);

  // 10. Print summary
  printExecuteSummary(result.response, result.responsePath, outOfTerritory);

  // 11. Return exit code
  if (result.response.response === 'done') {
    return 0;
  }
  return 1;
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
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        snapshot.set(relPath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
        // File may have been deleted between readdir and stat
      }
    }
  }
}

/**
 * Compare before and after snapshots to find files that were added or modified.
 * Returns an array of relative paths.
 */
function detectChangedFiles(
  before: Map<string, FileSnapshot>,
  after: Map<string, FileSnapshot>,
): string[] {
  const changed: string[] = [];

  // Check for new files or modified files
  for (const [path, afterEntry] of after) {
    const beforeEntry = before.get(path);
    if (!beforeEntry) {
      // New file
      changed.push(path);
    } else if (
      beforeEntry.mtimeMs !== afterEntry.mtimeMs ||
      beforeEntry.size !== afterEntry.size
    ) {
      // Modified file
      changed.push(path);
    }
  }

  return changed;
}

/**
 * Given a list of changed files (relative paths), identify which ones
 * are outside the angel's territory.
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

  const outOfTerritory: string[] = [];
  for (const relPath of changedFiles) {
    const absPath = resolve(projectRoot, relPath);
    // A file is in-territory if its absolute path starts with the territory path + separator
    if (
      !absPath.startsWith(territoryAbsPath + '/') &&
      absPath !== territoryAbsPath
    ) {
      outOfTerritory.push(relPath);
    }
  }

  return outOfTerritory;
}

/**
 * Append a newspaper entry for the execute action.
 * If there are out-of-territory writes, add a warning.
 */
function appendNewspaperEntry(
  projectRoot: string,
  angelId: string,
  response: ResponseData,
  outOfTerritory: string[],
): void {
  const timestamp = new Date().toISOString();

  let summary: string;
  const detailLines: string[] = [];

  if (response.response === 'done') {
    summary = 'EXECUTE completed successfully.';
    if (response.filesChanged) {
      detailLines.push(`Files changed: ${response.filesChanged}`);
    }
    if (response.angelMdUpdated === 'true') {
      detailLines.push('angel.md was updated.');
    }
  } else {
    summary = `EXECUTE finished with RESPONSE: ${response.response}`;
    if (response.concerns) {
      detailLines.push(`Concerns: ${response.concerns}`);
    }
  }

  if (outOfTerritory.length > 0) {
    detailLines.push('WARNING: Out-of-territory writes detected:');
    for (const file of outOfTerritory) {
      detailLines.push(`  - ${file}`);
    }
  }

  appendNewspaper(projectRoot, {
    timestamp,
    angelId,
    summary,
    details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
  });
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
    if (response.filesChanged) {
      console.log('FILES CHANGED:');
      console.log(`  ${response.filesChanged}`);
      console.log('');
    }

    if (response.angelMdUpdated === 'true') {
      console.log('angel.md was updated.');
      console.log('');
    }

    if (response.cablesSent && response.cablesSent !== 'none') {
      console.log('CABLES SENT:');
      console.log(`  ${response.cablesSent}`);
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
