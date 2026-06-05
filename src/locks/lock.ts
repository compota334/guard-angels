import * as fs from 'node:fs';
import * as path from 'node:path';
import { locksDir } from '../paths/layout.js';

const LOCK_FILENAME = 'orchestrator.lock';
const MAX_LOCK_RETRIES = 10;

export interface LockInfo {
  pid: number;
  startedAt: string;
  ttlMs: number;
}

/**
 * Locks currently held by this process, keyed by absolute lock path.
 * Used by the signal handlers to release every held lock on SIGTERM/SIGINT
 * so a terminated orchestrator does not leave stale lock files behind.
 */
const heldLocks = new Map<string, { projectRoot: string; scope?: string }>();
let signalHandlersRegistered = false;

/**
 * Install SIGTERM/SIGINT handlers (once) that release every held lock and then
 * re-raise the signal so the process exits with conventional signal semantics.
 */
function registerSignalHandlers(): void {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;

  const handler = (signal: NodeJS.Signals): void => {
    for (const { projectRoot, scope } of heldLocks.values()) {
      try {
        releaseLock(projectRoot, scope);
      } catch (err: unknown) {
        // Best-effort cleanup during shutdown: surface the failure but keep
        // releasing the remaining locks instead of aborting on the first one.
        process.stderr.write(
          `Failed to release lock during ${signal}: ${(err as Error).message ?? String(err)}\n`,
        );
      }
    }
    // Restore default behavior and re-raise so exit codes reflect the signal
    // (130 for SIGINT, 143 for SIGTERM) rather than a fabricated value.
    process.removeListener('SIGTERM', handler);
    process.removeListener('SIGINT', handler);
    process.kill(process.pid, signal);
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

/**
 * Acquire the global orchestrator lock.
 * If a stale lock is found (PID dead or TTL elapsed), it is reclaimed.
 * Throws if a valid lock is held by another process.
 *
 * Returns the lock file path on success.
 */
export function acquireLock(projectRoot: string, ttlMs: number, scope?: string): string {
  const dir = locksDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const lockFileName = scope ? `orchestrator-${scope}.lock` : LOCK_FILENAME;
  const lockPath = path.join(dir, lockFileName);

  const info: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ttlMs,
  };
  const content = serializeLock(info);

  for (let attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
    try {
      // wx flag: exclusive create — fails atomically with EEXIST if file exists
      fs.writeFileSync(lockPath, content, { encoding: 'utf-8', flag: 'wx' });
      heldLocks.set(lockPath, { projectRoot, scope });
      registerSignalHandlers();
      return lockPath;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      // Lock file exists — re-read and check staleness
      const existing = readLock(lockPath);
      if (existing && !isStale(existing)) {
        throw new Error(
          `Orchestrator lock is held by PID ${existing.pid} (started ${existing.startedAt}). ` +
            `If the process is not running, delete ${lockPath} manually or wait for TTL expiry.`,
        );
      }
      // Stale or unreadable — remove and retry the atomic write
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Another process may have already removed it — proceed to retry
      }
    }
  }

  throw new Error(
    `Failed to acquire orchestrator lock at ${lockPath} after ${MAX_LOCK_RETRIES} attempts.`,
  );
}

/**
 * Release the orchestrator lock.
 * Only removes the lock file if it is still owned by the current process.
 */
export function releaseLock(projectRoot: string, scope?: string): void {
  const lockFileName = scope ? `orchestrator-${scope}.lock` : LOCK_FILENAME;
  const lockPath = path.join(locksDir(projectRoot), lockFileName);
  // Stop tracking this lock regardless of outcome — we are relinquishing it.
  heldLocks.delete(lockPath);
  const existing = readLock(lockPath);
  if (!existing) return;

  // Only release if we own it
  if (existing.pid === process.pid) {
    try {
      fs.unlinkSync(lockPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new Error(
          `Failed to release orchestrator lock at ${lockPath}: ${(err as Error).message}`,
          { cause: err },
        );
      }
    }
  }
}

/**
 * Read the lock file and parse its contents.
 * Returns null if the file doesn't exist or is malformed.
 */
export function readLock(lockPath: string): LockInfo | null {
  let content: string;
  try {
    content = fs.readFileSync(lockPath, 'utf-8');
  } catch {
    return null;
  }
  return parseLock(content);
}

/**
 * Check whether a lock is stale.
 * A lock is stale if:
 * 1. The owning PID is no longer alive, OR
 * 2. The TTL has elapsed since startedAt
 */
export function isStale(info: LockInfo): boolean {
  // Check if PID is alive
  if (!isPidAlive(info.pid)) {
    return true;
  }

  // Check TTL
  const startedMs = new Date(info.startedAt).getTime();
  if (isNaN(startedMs)) {
    // Malformed timestamp — treat as stale
    return true;
  }

  const elapsed = Date.now() - startedMs;
  return elapsed > info.ttlMs;
}

/**
 * Get the path to the orchestrator lock file.
 */
export function lockFilePath(projectRoot: string): string {
  return path.join(locksDir(projectRoot), LOCK_FILENAME);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function serializeLock(info: LockInfo): string {
  return [
    `pid: ${info.pid}`,
    `started_at: ${info.startedAt}`,
    `ttl_ms: ${info.ttlMs}`,
  ].join('\n') + '\n';
}

function parseLock(content: string): LockInfo | null {
  const pidMatch = content.match(/^pid:\s*(\d+)$/m);
  const startedMatch = content.match(/^started_at:\s*(.+)$/m);
  const ttlMatch = content.match(/^ttl_ms:\s*(\d+)$/m);

  if (!pidMatch || !startedMatch || !ttlMatch) {
    return null;
  }

  return {
    pid: parseInt(pidMatch[1], 10),
    startedAt: startedMatch[1].trim(),
    ttlMs: parseInt(ttlMatch[1], 10),
  };
}
