import { execa } from 'execa';
import type { BackendAdapter, InvokeOptions, InvokeResult } from './adapter.js';

const SESSION_ID_RE = /session[_\- ]?id[:\s]+(\S+)/i;

export class ClaudeAdapter implements BackendAdapter {
  readonly name = 'claude';

  private readonly baseCmd: string;
  private readonly baseArgs: string[];

  constructor(cmd: string, args: string[]) {
    this.baseCmd = cmd;
    this.baseArgs = args;
  }

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const args = [...this.baseArgs, ...(opts.extraArgs ?? []), opts.prompt];

    const result = await execa(this.baseCmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      reject: false,
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
    const match = SESSION_ID_RE.exec(stdout);
    return match?.[1] ?? null;
  }
}
