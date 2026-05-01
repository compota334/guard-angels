export const DEFAULT_BACKEND_CMD = process.env.GUARD_ANGELS_BACKEND_CMD ?? 'claude -p --dangerously-skip-permissions';
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_SWEEP_AUTONOMY = 'report-only' as const;
