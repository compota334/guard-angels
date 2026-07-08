export interface InvokeOptions {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  extraArgs?: string[];
}

/**
 * Token usage reported by the backend for one invocation.
 * Only adapters with structured output (Claude Code) can provide this.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface InvokeResult {
  stdout: string;
  stderr: string;
  code: number;
  sessionId?: string;
  usage?: TokenUsage;
  costUsd?: number;
}

export interface BackendAdapter {
  name: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
  extractSessionId?(stdout: string): string | null;
}
