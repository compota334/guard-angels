export interface InvokeOptions {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  extraArgs?: string[];
}

export interface InvokeResult {
  stdout: string;
  stderr: string;
  code: number;
  sessionId?: string;
}

export interface BackendAdapter {
  name: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
  extractSessionId?(stdout: string): string | null;
}
