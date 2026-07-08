import { execa } from 'execa';
import type { BackendAdapter, InvokeOptions, InvokeResult, TokenUsage } from './adapter.js';

/**
 * The JSON envelope printed by `claude -p --output-format json`.
 * Only the fields we consume are modeled; the envelope carries many more.
 */
interface ClaudeEnvelope {
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class ClaudeAdapter implements BackendAdapter {
  readonly name = 'claude';

  private readonly baseCmd: string;
  private readonly baseArgs: string[];

  constructor(cmd: string, args: string[]) {
    this.baseCmd = cmd;
    this.baseArgs = args;
  }

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const args = [...this.baseArgs, ...(opts.extraArgs ?? [])];

    // Structured output gives us session_id and token usage reliably.
    // Respect an explicit --output-format in the configured command; only
    // parse the envelope when the effective format is json.
    const explicitFormat = findOutputFormat(args);
    if (explicitFormat === null) {
      args.push('--output-format', 'json');
    }
    const expectJsonEnvelope = explicitFormat === null || explicitFormat === 'json';

    args.push(opts.prompt);

    const result = await execa(this.baseCmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      reject: false,
      stdin: 'ignore',
      env: {
        ...process.env,
        CLAUDECODE: '',
        CLAUDE_CODE_ENTRYPOINT: '',
        CLAUDE_CODE_EXECPATH: '',
      },
    });

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const code = result.exitCode ?? 1;

    if (code !== 0 || !expectJsonEnvelope) {
      return { stdout, stderr, code };
    }

    const envelope = parseEnvelope(stdout);
    return {
      stdout,
      stderr,
      code,
      ...(envelope.session_id != null && { sessionId: envelope.session_id }),
      ...(envelope.usage != null && { usage: mapUsage(envelope.usage) }),
      ...(envelope.total_cost_usd != null && { costUsd: envelope.total_cost_usd }),
    };
  }
}

/**
 * Return the value of an explicit --output-format argument, or null if absent.
 * Supports both "--output-format json" and "--output-format=json".
 */
function findOutputFormat(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-format') {
      return args[i + 1] ?? '';
    }
    if (args[i].startsWith('--output-format=')) {
      return args[i].slice('--output-format='.length);
    }
  }
  return null;
}

/**
 * Parse the claude CLI JSON envelope. A zero exit with an unparseable
 * envelope means the CLI did not honor --output-format json — that is a
 * protocol failure, not something to silently ignore.
 */
function parseEnvelope(stdout: string): ClaudeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err: unknown) {
    throw new Error(
      `claude backend exited 0 but stdout is not the expected JSON envelope ` +
        `(--output-format json): ${(err as Error).message}. First bytes: ` +
        `${stdout.slice(0, 200)}`,
      { cause: err },
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(
      `claude backend JSON envelope is not an object. First bytes: ${stdout.slice(0, 200)}`,
    );
  }
  return parsed as ClaudeEnvelope;
}

function mapUsage(usage: NonNullable<ClaudeEnvelope['usage']>): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}
