import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readAngelMd } from '../angels/memory.js';
import { pickAdapter } from '../backend/factory.js';
import { acquireLock, releaseLock } from '../locks/lock.js';
import { createLogStreams, writeLogMeta } from '../logs/log.js';
import { buildPrompt } from './prompt.js';
import { parseResponse } from './response.js';
import { parseBrief } from './brief.js';
import { angelMdFile, angelResponsesDir } from '../paths/layout.js';
import { angelIdToPath } from '../paths/resolve.js';
import type { PromptPhase, InboxEntry } from './prompt.js';
import type { ResponseData } from './response.js';
import type { LogMeta } from '../logs/log.js';

const LOCK_TTL_PADDING_MS = 30_000;

/**
 * Thrown when an angel invocation fails in a way that produces no usable
 * response: timeout, missing response file, or unparseable response file.
 * Lock release and log writes still happen before this is thrown.
 */
export class OrchestrationError extends Error {
  override readonly name = 'OrchestrationError';
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'missing_response',
    public readonly logStdoutPath: string,
    public readonly logStderrPath: string,
    public readonly logMetaPath: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface InvokeInput {
  phase: PromptPhase;
  angelId: string;
  briefPath: string;
  newspaperDelta?: string;
  inbox?: InboxEntry[];
}

export interface InvokeOutput {
  response: ResponseData;
  responsePath: string;
  logStdoutPath: string;
  logStderrPath: string;
  logMetaPath: string;
}

/**
 * Orchestrate a single angel invocation:
 * 1. Acquire the global lock
 * 2. Build the prompt
 * 3. Spawn the backend adapter
 * 4. Stream stdout/stderr to log files
 * 5. Write .meta.json with sessionId on success
 * 6. Parse the response file the angel wrote
 * 7. Release the lock
 */
export async function invoke(
  projectRoot: string,
  input: InvokeInput,
): Promise<InvokeOutput> {
  const config = loadConfig(projectRoot);
  const registry = AngelRegistry.fromConfig(config);
  const angel = registry.getById(input.angelId);
  const adapter = pickAdapter(config);

  const timeoutMs = config.backend.angel_timeout_seconds * 1000;
  const lockTtlMs = timeoutMs + LOCK_TTL_PADDING_MS;

  // 1. Acquire lock
  acquireLock(projectRoot, lockTtlMs);

  const timestamp = new Date().toISOString();

  try {
    // 2. Read angel.md if it exists
    const angelPath = angelIdToPath(input.angelId);
    const angelMdPath = angelMdFile(projectRoot, angelPath === '.' ? '_root' : angelPath);
    let angelMdContent: string | null = null;
    try {
      const angelMd = readAngelMd(angelMdPath);
      angelMdContent = fs.readFileSync(angelMdPath, 'utf-8');
      void angelMd; // validated by readAngelMd
    } catch {
      // No angel.md yet — that's fine for init phase
      angelMdContent = null;
    }

    // 3. Read the brief file
    const briefContent = fs.readFileSync(input.briefPath, 'utf-8');
    // Validate the brief (throws if malformed)
    parseBrief(input.briefPath);

    // 4. Get folder listing
    const folderAbsPath = resolve(projectRoot, angelPath);
    let folderListing = '';
    try {
      const entries = fs.readdirSync(folderAbsPath);
      folderListing = entries.join('\n');
    } catch {
      folderListing = '(folder does not exist or is empty)';
    }

    // 5. Compute response file path
    const responsePath = computeResponsePath(projectRoot, input.angelId, timestamp);

    // 6. Build prompt
    const prompt = buildPrompt({
      phase: input.phase,
      angelId: input.angelId,
      angelPath,
      angelType: angel.type,
      folderListing,
      angelMd: angelMdContent,
      newspaperDelta: input.newspaperDelta ?? '',
      inbox: input.inbox ?? [],
      brief: briefContent,
      responsePath,
    });

    // 7. Create log streams
    const logs = createLogStreams(projectRoot, input.angelId, timestamp);

    let timedOut = false;
    let timeoutCause: unknown;
    let exitCode = 1;
    let sessionId: string | undefined;
    let stdout = '';
    let stderr = '';

    try {
      // 8. Spawn backend adapter
      const result = await adapter.invoke({
        prompt,
        cwd: projectRoot,
        timeoutMs,
      });

      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.code;
      sessionId = result.sessionId;

      // Write to log files
      logs.appendStdout(stdout);
      logs.appendStderr(stderr);
    } catch (err: unknown) {
      // Check if this is a timeout error from execa
      if (isTimeoutError(err)) {
        timedOut = true;
        exitCode = 124; // conventional timeout exit code
        timeoutCause = err;

        const timeoutStderr = `Angel invocation timed out after ${config.backend.angel_timeout_seconds} seconds`;
        logs.appendStderr(timeoutStderr);
      } else {
        throw err;
      }
    } finally {
      logs.close();
    }

    // 9. Write meta.json (always, even on timeout — the .meta.json carries
    // the timedOut flag which is the source of truth for "how did this end")
    const meta: LogMeta = {
      angelId: input.angelId,
      phase: input.phase,
      briefPath: input.briefPath,
      responsePath,
      exitCode,
      ...(sessionId != null && { sessionId }),
      startedAt: timestamp,
      finishedAt: new Date().toISOString(),
      timedOut,
    };
    const logMetaPath = writeLogMeta(projectRoot, input.angelId, timestamp, meta);

    // 10. If the invocation timed out, throw — there is no response file to
    // parse, and the orchestrator must not fabricate one.
    if (timedOut) {
      throw new OrchestrationError(
        `Angel "${input.angelId}" timed out after ${config.backend.angel_timeout_seconds}s. Logs: ${logs.stderrPath}`,
        'timeout',
        logs.stdoutPath,
        logs.stderrPath,
        logMetaPath,
        timeoutCause ? { cause: timeoutCause } : undefined,
      );
    }

    // 11. Parse the response file. If the angel exited cleanly but didn't
    // write a parseable response, that's a hard failure — throw rather than
    // fabricate a synthetic response on disk.
    let response: ResponseData;
    try {
      response = parseResponse(responsePath);
    } catch (err: unknown) {
      throw new OrchestrationError(
        `Angel "${input.angelId}" did not produce a valid response file at ${responsePath}. Logs: ${logs.stderrPath}`,
        'missing_response',
        logs.stdoutPath,
        logs.stderrPath,
        logMetaPath,
        { cause: err },
      );
    }

    return {
      response,
      responsePath,
      logStdoutPath: logs.stdoutPath,
      logStderrPath: logs.stderrPath,
      logMetaPath,
    };
  } finally {
    // 12. Always release the lock
    releaseLock(projectRoot);
  }
}

/**
 * Compute the response file path for a given angel and timestamp.
 */
function computeResponsePath(
  projectRoot: string,
  angelId: string,
  isoTimestamp: string,
): string {
  const dir = angelResponsesDir(projectRoot, angelId);
  fs.mkdirSync(dir, { recursive: true });

  const datePrefix = extractDatePrefix(isoTimestamp);
  const seq = computeNextSeq(dir, datePrefix);
  return join(dir, `${datePrefix}-${seq}.md`);
}

function extractDatePrefix(isoTimestamp: string): string {
  const match = isoTimestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    throw new Error(
      `Invalid ISO timestamp for response filename: "${isoTimestamp}"`,
    );
  }
  const [, date, hours, minutes] = match;
  return `${date}T${hours}${minutes}`;
}

function computeNextSeq(dir: string, datePrefix: string): string {
  const dateOnly = datePrefix.slice(0, 10);
  let maxSeq = 0;

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    const match = entry.match(/^(\d{4}-\d{2}-\d{2})T\d{4}-(\d{3})\.md$/);
    if (match && match[1] === dateOnly) {
      const seq = parseInt(match[2], 10);
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return String(maxSeq + 1).padStart(3, '0');
}

function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    return (err as Record<string, unknown>).timedOut === true;
  }
  return false;
}
