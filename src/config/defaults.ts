import type { MemoryConfig } from './schema.js';

export const DEFAULT_BACKEND_CMD = process.env.GUARD_ANGELS_BACKEND_CMD ?? 'claude -p --dangerously-skip-permissions';
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_SWEEP_AUTONOMY = 'report-only' as const;
export const DEFAULT_MEMORY_TARGET_PCT = 25;

/**
 * Byte threshold above which a built prompt triggers a diagnostic warning.
 * Configurable via GUARD_ANGELS_PROMPT_WARN_BYTES; defaults to ~80KB.
 * Throws on an invalid override rather than silently falling back.
 */
export const DEFAULT_PROMPT_WARN_BYTES: number = (() => {
  const raw = process.env.GUARD_ANGELS_PROMPT_WARN_BYTES;
  if (raw === undefined || raw === '') return 80_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid GUARD_ANGELS_PROMPT_WARN_BYTES="${raw}": must be a positive number`,
    );
  }
  return n;
})();

/**
 * Resolve memory config into absolute token budget.
 * If `max_tokens` is explicitly set, it takes priority and targetPct is 0 (meaning: not derived from percentage).
 * Otherwise, `target_pct` is applied against the provided contextWindow.
 */
export function resolveMemoryConfig(
  memory: MemoryConfig | undefined,
  contextWindow: number,
): { targetPct: number; maxTokens: number } {
  if (!memory) {
    const targetPct = DEFAULT_MEMORY_TARGET_PCT;
    return { targetPct, maxTokens: Math.floor(contextWindow * (targetPct / 100)) };
  }
  if (memory.max_tokens !== undefined) {
    return { targetPct: 0, maxTokens: memory.max_tokens };
  }
  const targetPct = memory.target_pct ?? DEFAULT_MEMORY_TARGET_PCT;
  return { targetPct, maxTokens: Math.floor(contextWindow * (targetPct / 100)) };
}
