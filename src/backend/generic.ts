import { execa } from 'execa';
import type { BackendAdapter, InvokeOptions, InvokeResult } from './adapter.js';

export class GenericAdapter implements BackendAdapter {
  readonly name = 'generic';

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

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.exitCode ?? 1,
    };
  }
}
