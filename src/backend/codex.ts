import { execa } from 'execa';
import type { BackendAdapter, InvokeOptions, InvokeResult } from './adapter.js';

const THREAD_ID_RE = /thread[_\- ]?id[:\s]+(\S+)/i;

export class CodexAdapter implements BackendAdapter {
  readonly name = 'codex';

  private readonly baseCmd: string;
  private readonly baseArgs: string[];

  constructor(cmd: string, args: string[]) {
    this.baseCmd = cmd;
    this.baseArgs = args;
  }

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const args = [...this.baseArgs, ...(opts.extraArgs ?? [])];

    const result = await execa(this.baseCmd, args, {
      input: opts.prompt,
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      reject: false,
      env: { ...process.env, ...(opts.env ?? {}) },
    });

    const sessionId = this.extractSessionId(result.stdout);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.exitCode ?? 1,
      ...(sessionId != null && { sessionId }),
    };
  }

  extractSessionId(stdout: string): string | null {
    const match = THREAD_ID_RE.exec(stdout);
    return match?.[1] ?? null;
  }
}
