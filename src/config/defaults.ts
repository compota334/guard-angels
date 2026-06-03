import type { MemoryConfig } from './schema.js';

export const DEFAULT_BACKEND_CMD = process.env.GUARD_ANGELS_BACKEND_CMD ?? 'claude -p --dangerously-skip-permissions';
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_SWEEP_AUTONOMY = 'report-only' as const;
export const DEFAULT_MEMORY_TARGET_PCT = 25;

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
