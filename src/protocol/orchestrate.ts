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
import { extractDatePrefix, computeNextSeq } from './parser-utils.js';
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
    public readonly kind: 'timeout' | 'missing_response' | 'spawn_error',
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
  timeoutSeconds?: number;
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

  const resolvedTimeoutSeconds = input.timeoutSeconds ?? config.backend.angel_timeout_seconds;
  const timeoutMs = resolvedTimeoutSeconds * 1000;
  const lockTtlMs = timeoutMs + LOCK_TTL_PADDING_MS;

  // 1. Acquire lock
  acquireLock(projectRoot, lockTtlMs);

  try {
    // FIX 6: timestamp inside try so it's in scope for all log/response helpers
    const timestamp = new Date().toISOString();

    // 2. Read angel.md if it exists
    const angelPath = angelIdToPath(input.angelId);
    const angelMdPath = angelMdFile(projectRoot, angelPath === '.' ? '_root' : angelPath);
    let angelMdContent: string | null = null;
    try {
      // FIX 6: readAngelMd now exposes .raw — eliminates the double read
      const angelMd = readAngelMd(angelMdPath);
      angelMdContent = angelMd.raw ?? null;
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
    let spawnError: unknown;
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

      // FIX 5: null-coalesce in case the adapter returns null/undefined
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
      exitCode = result.code;
      sessionId = result.sessionId;

      // Write to log files
      logs.appendStdout(stdout);
      logs.appendStderr(stderr);
    } catch (err: unknown) {
      // FIX 6: execa >=8 sets timedOut=true on the error object when --timeout expires
      if (isTimeoutError(err)) {
        timedOut = true;
        exitCode = 124; // conventional timeout exit code
        timeoutCause = err;

        const timeoutStderr = `Angel invocation timed out after ${resolvedTimeoutSeconds} seconds`;
        logs.appendStderr(timeoutStderr);
      } else {
        // FIX 4: store non-timeout errors so meta.json is written before we throw
        spawnError = err;
        exitCode = 1;
        logs.appendStderr(
          `Angel invocation failed: ${(err as Error).message ?? String(err)}`,
        );
      }
    } finally {
      // FIX 3: wrap close() so it cannot shadow the original exception
      try {
        logs.close();
      } catch (closeErr: unknown) {
        console.error('Failed to close log streams:', closeErr);
      }
    }

    // 9. Write meta.json (always, even on timeout or spawn error — the .meta.json
    // carries the timedOut/spawnError flag which is the source of truth for outcome)
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
      ...(spawnError != null && { spawnError: true }),
    };
    const logMetaPath = writeLogMeta(projectRoot, input.angelId, timestamp, meta);

    // FIX 4: throw wrapped OrchestrationError now that meta.json has been written
    if (spawnError != null) {
      throw new OrchestrationError(
        `Angel "${input.angelId}" invocation failed: ${(spawnError as Error).message ?? String(spawnError)}. Logs: ${logs.stderrPath}`,
        'spawn_error',
        logs.stdoutPath,
        logs.stderrPath,
        logMetaPath,
        { cause: spawnError },
      );
    }

    // 10. If the invocation timed out, throw — there is no response file to
    // parse, and the orchestrator must not fabricate one.
    if (timedOut) {
      throw new OrchestrationError(
        `Angel "${input.angelId}" timed out after ${resolvedTimeoutSeconds}s. Logs: ${logs.stderrPath}`,
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

  const datePrefix = extractDatePrefix(isoTimestamp, 'response');
  const seq = computeNextSeq(dir, datePrefix);
  return join(dir, `${datePrefix}-${seq}.md`);
}

// execa >=8 sets .timedOut = true on the thrown error when the child process
// hits the timeout option — this is distinct from a process that exits non-zero.
function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    return (err as Record<string, unknown>).timedOut === true;
  }
  return false;
}
