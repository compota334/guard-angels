import * as fs from 'node:fs';
import { join } from 'node:path';
import { angelLogsDir } from '../paths/layout.js';

/**
 * Create log file streams for an angel invocation.
 * Writes go to .angels/_logs/<angel-id>/<timestamp>.stdout and .stderr
 *
 * Returns the file descriptors and paths so the caller can stream to them
 * and close them when done.
 */
export function createLogStreams(
  projectRoot: string,
  angelId: string,
  timestamp: string,
): LogStreams {
  const dir = angelLogsDir(projectRoot, angelId);
  fs.mkdirSync(dir, { recursive: true });

  const sanitizedTimestamp = sanitizeTimestamp(timestamp);
  const stdoutPath = join(dir, `${sanitizedTimestamp}.stdout`);
  const stderrPath = join(dir, `${sanitizedTimestamp}.stderr`);

  const stdoutFd = fs.openSync(stdoutPath, 'w');
  let stderrFd: number;
  try {
    stderrFd = fs.openSync(stderrPath, 'w');
  } catch (err: unknown) {
    fs.closeSync(stdoutFd);
    throw err;
  }

  return {
    stdoutPath,
    stderrPath,
    stdoutFd,
    stderrFd,
    appendStdout(data: string): void {
      fs.writeSync(stdoutFd, data);
    },
    appendStderr(data: string): void {
      fs.writeSync(stderrFd, data);
    },
    close(): void {
      try {
        fs.closeSync(stdoutFd);
      } catch {
        // Ignore close errors
      }
      try {
        fs.closeSync(stderrFd);
      } catch {
        // Ignore close errors
      }
    },
  };
}

/**
 * Write the optional .meta.json file alongside logs.
 * Contains session ID, exit code, and timing info.
 */
export function writeLogMeta(
  projectRoot: string,
  angelId: string,
  timestamp: string,
  meta: LogMeta,
): string {
  const dir = angelLogsDir(projectRoot, angelId);
  fs.mkdirSync(dir, { recursive: true });

  const sanitizedTimestamp = sanitizeTimestamp(timestamp);
  const metaPath = join(dir, `${sanitizedTimestamp}.meta.json`);

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  return metaPath;
}

export interface LogStreams {
  stdoutPath: string;
  stderrPath: string;
  stdoutFd: number;
  stderrFd: number;
  appendStdout(data: string): void;
  appendStderr(data: string): void;
  close(): void;
}

export interface LogMeta {
  angelId: string;
  phase: string;
  briefPath: string;
  responsePath: string;
  exitCode: number;
  sessionId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  costUsd?: number;
  startedAt: string;
  finishedAt: string;
  timedOut: boolean;
  spawnError?: boolean;
}

/**
 * Sanitize an ISO timestamp for use in filenames.
 * Replaces colons with dashes to avoid filesystem issues on some systems.
 */
function sanitizeTimestamp(iso: string): string {
  return iso.replace(/:/g, '-');
}
