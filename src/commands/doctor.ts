import * as fs from 'node:fs';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { identifyCandidates } from '../angels/identify.js';
import { readLock, isStale, lockFilePath, type LockInfo } from '../locks/lock.js';
import { readAngelMd } from '../angels/memory.js';
import { angelMdFile, briefsDir, responsesDir, logsDir, archiveDir } from '../paths/layout.js';
import type { Config } from '../config/schema.js';

// --- Report types ---

export interface OrphanedAngel {
  id: string;
  registeredPath: string;
}

export interface MissingAngel {
  path: string;
  reason: string;
}

export interface StaleLockReport {
  lockPath: string;
  info: LockInfo;
}

export interface StaleDraft {
  angelId: string;
  angelPath: string;
  lastUpdated: string;
  daysStale: number;
}

export interface ArchivedFile {
  sourcePath: string;
  destPath: string;
}

export interface ArchiveResult {
  movedFiles: ArchivedFile[];
  thresholdDays: number;
}

export interface DoctorReport {
  orphanedAngels: OrphanedAngel[];
  missingAngels: MissingAngel[];
  staleLocks: StaleLockReport[];
  staleDrafts: StaleDraft[];
}

// --- Pure check functions ---

/**
 * Find angels registered in _config.yml whose project folder no longer exists.
 * The root angel (path ".") is always valid — it represents the project root itself.
 */
export function checkOrphanedAngels(
  projectRoot: string,
  config: Config,
): OrphanedAngel[] {
  const orphaned: OrphanedAngel[] = [];
  for (const angel of config.angels) {
    if (angel.path === '.') continue; // root angel always valid
    const folderPath = resolve(projectRoot, angel.path);
    if (!fs.existsSync(folderPath) || !isDirectory(folderPath)) {
      orphaned.push({ id: angel.id, registeredPath: angel.path });
    }
  }
  return orphaned;
}

/**
 * Find project folders that look significant (per heuristics) but have no registered angel.
 */
export async function checkMissingAngels(
  projectRoot: string,
  registry: AngelRegistry,
): Promise<MissingAngel[]> {
  const candidates = await identifyCandidates(projectRoot);
  const missing: MissingAngel[] = [];
  for (const candidate of candidates) {
    try {
      registry.getByPath(candidate.path);
    } catch {
      missing.push({ path: candidate.path, reason: candidate.reason });
    }
  }
  return missing;
}

/**
 * Check if the orchestrator lock is stale (PID dead or TTL elapsed).
 * Returns null if no lock file exists or if the lock is valid (not stale).
 */
export function checkStaleLocks(projectRoot: string): StaleLockReport | null {
  const lp = lockFilePath(projectRoot);
  const info = readLock(lp);
  if (!info) return null;
  if (isStale(info)) {
    return { lockPath: lp, info };
  }
  return null;
}

/**
 * Find angel.md files with status: draft that are older than N days.
 */
export function checkStaleDrafts(
  projectRoot: string,
  config: Config,
  thresholdDays: number,
): StaleDraft[] {
  const staleDrafts: StaleDraft[] = [];
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

  for (const angel of config.angels) {
    const angelPath = angel.type === 'root' ? '_root' : angel.path;
    const mdPath = angelMdFile(projectRoot, angelPath);
    let md;
    try {
      md = readAngelMd(mdPath);
    } catch {
      // angel.md doesn't exist or is malformed — not a draft staleness issue
      continue;
    }

    if (md.frontmatter.status !== 'draft') continue;

    const updatedMs = new Date(md.frontmatter.last_updated).getTime();
    if (isNaN(updatedMs)) continue;

    const elapsed = now - updatedMs;
    if (elapsed > thresholdMs) {
      staleDrafts.push({
        angelId: angel.id,
        angelPath: angel.path,
        lastUpdated: md.frontmatter.last_updated,
        daysStale: Math.floor(elapsed / (24 * 60 * 60 * 1000)),
      });
    }
  }

  return staleDrafts;
}

// --- Archive ---

const ARCHIVABLE_DIRS = ['_briefs', '_responses', '_logs'] as const;

/**
 * Recursively collect all files under a directory.
 */
function collectFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Archive old files from _briefs/, _responses/, _logs/ into _archive/<YYYY-MM>/.
 * Files are moved (not copied), preserving their relative path under each top-level directory.
 * Newspaper, cursors, _config.yml, and angel.md files are NEVER archived.
 */
export function archiveOldFiles(
  projectRoot: string,
  thresholdDays: number,
): ArchiveResult {
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const archive = archiveDir(projectRoot);
  const movedFiles: ArchivedFile[] = [];

  const sourceDirs: Record<string, string> = {
    _briefs: briefsDir(projectRoot),
    _responses: responsesDir(projectRoot),
    _logs: logsDir(projectRoot),
  };

  for (const [topName, topDir] of Object.entries(sourceDirs)) {
    const files = collectFiles(topDir);
    for (const filePath of files) {
      // Skip angel.md files (should never appear here, but belt-and-suspenders)
      if (basename(filePath) === 'angel.md') continue;

      const stat = fs.statSync(filePath);
      const fileAge = now - stat.mtimeMs;

      if (fileAge > thresholdMs) {
        // Compute archive destination: _archive/<YYYY-MM>/<topName>/<relative-path>
        const fileDate = new Date(stat.mtimeMs);
        const yearMonth = `${fileDate.getFullYear()}-${String(fileDate.getMonth() + 1).padStart(2, '0')}`;
        const relPath = relative(topDir, filePath);
        const destPath = join(archive, yearMonth, topName, relPath);

        // Create destination directory
        fs.mkdirSync(dirname(destPath), { recursive: true });

        // Move file (rename if same filesystem, copy+delete otherwise)
        try {
          fs.renameSync(filePath, destPath);
        } catch {
          // Cross-device move: copy then delete
          fs.copyFileSync(filePath, destPath);
          fs.unlinkSync(filePath);
        }

        movedFiles.push({ sourcePath: filePath, destPath });
      }
    }
  }

  // Clean up empty directories left behind in the source dirs
  for (const topDir of Object.values(sourceDirs)) {
    cleanEmptyDirs(topDir);
  }

  return { movedFiles, thresholdDays };
}

/**
 * Recursively remove empty directories (bottom-up).
 */
function cleanEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      cleanEmptyDirs(join(dir, entry.name));
    }
  }

  // Re-read after recursive cleanup — directory may now be empty
  const remaining = fs.readdirSync(dir);
  if (remaining.length === 0) {
    // Don't remove the top-level archivable dirs themselves
    const parentBase = basename(dir);
    if (ARCHIVABLE_DIRS.includes(parentBase as typeof ARCHIVABLE_DIRS[number])) {
      return;
    }
    fs.rmdirSync(dir);
  }
}

/**
 * Format archive results as a human-readable string.
 */
export function formatArchiveResult(result: ArchiveResult): string {
  const lines: string[] = [];

  if (result.movedFiles.length === 0) {
    lines.push(`Archive: no files older than ${result.thresholdDays} day(s) found.`);
    return lines.join('\n');
  }

  lines.push(`Archive: moved ${result.movedFiles.length} file(s) (threshold: ${result.thresholdDays} day(s)).\n`);
  for (const f of result.movedFiles) {
    lines.push(`  ${f.sourcePath} → ${f.destPath}`);
  }

  return lines.join('\n');
}

// --- Composition + output ---

/**
 * Run all doctor checks and return a structured report.
 */
export async function runDoctorChecks(
  projectRoot: string,
  config: Config,
  registry: AngelRegistry,
  options?: { draftThresholdDays?: number },
): Promise<DoctorReport> {
  const draftThresholdDays = options?.draftThresholdDays ?? 7;

  const [orphanedAngels, missingAngels] = await Promise.all([
    checkOrphanedAngels(projectRoot, config),
    checkMissingAngels(projectRoot, registry),
  ]);

  const staleLockResult = checkStaleLocks(projectRoot);
  const staleLocks = staleLockResult ? [staleLockResult] : [];
  const staleDrafts = checkStaleDrafts(projectRoot, config, draftThresholdDays);

  return { orphanedAngels, missingAngels, staleLocks, staleDrafts };
}

/**
 * Format the doctor report as a human-readable string.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  const totalFindings =
    report.orphanedAngels.length +
    report.missingAngels.length +
    report.staleLocks.length +
    report.staleDrafts.length;

  if (totalFindings === 0) {
    lines.push('Doctor: all checks passed. No issues found.');
    return lines.join('\n');
  }

  lines.push(`Doctor: ${totalFindings} issue(s) found.\n`);

  if (report.orphanedAngels.length > 0) {
    lines.push('ORPHANED ANGELS (registered but folder missing):');
    for (const o of report.orphanedAngels) {
      lines.push(`  - ${o.id} (path: ${o.registeredPath})`);
    }
    lines.push('');
  }

  if (report.missingAngels.length > 0) {
    lines.push('MISSING ANGELS (significant folders without an angel):');
    for (const m of report.missingAngels) {
      lines.push(`  - ${m.path} (${m.reason})`);
    }
    lines.push('');
  }

  if (report.staleLocks.length > 0) {
    lines.push('STALE LOCKS:');
    for (const s of report.staleLocks) {
      lines.push(
        `  - ${s.lockPath} (PID: ${s.info.pid}, started: ${s.info.startedAt})`,
      );
    }
    lines.push('');
  }

  if (report.staleDrafts.length > 0) {
    lines.push('STALE DRAFTS (draft angel.md older than threshold):');
    for (const d of report.staleDrafts) {
      lines.push(
        `  - ${d.angelId} (path: ${d.angelPath}, last updated: ${d.lastUpdated}, ${d.daysStale} days ago)`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Main entry point for the `angels doctor` command.
 * Returns exit code: 0 if no issues (and no archive action), 1 if findings exist.
 */
export async function runDoctor(
  cwd: string,
  options?: { draftThresholdDays?: number; archive?: boolean; olderThanDays?: number },
): Promise<number> {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  const report = await runDoctorChecks(cwd, config, registry, options);

  const output = formatDoctorReport(report);
  console.log(output);

  if (options?.archive) {
    const thresholdDays = options.olderThanDays ?? 30;
    const archiveResult = archiveOldFiles(cwd, thresholdDays);
    const archiveOutput = formatArchiveResult(archiveResult);
    console.log(archiveOutput);
  }

  const totalFindings =
    report.orphanedAngels.length +
    report.missingAngels.length +
    report.staleLocks.length +
    report.staleDrafts.length;

  return totalFindings > 0 ? 1 : 0;
}

// --- Helpers ---

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
