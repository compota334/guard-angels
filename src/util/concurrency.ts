/**
 * Run `fn` over `items` with at most `limit` concurrent executions.
 *
 * Sliding-window pool: a new item starts as soon as a slot frees up; there
 * is no batch barrier, so wall-clock time tracks the slowest items rather
 * than the slowest item of each batch.
 *
 * Results preserve input order. Rejections are captured per item (the
 * returned array mirrors Promise.allSettled), so one failure never cancels
 * the remaining work.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

/** Clamp a user-provided parallelism value to a sane range. */
export function clampParallel(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--parallel must be a positive integer, got: ${value}`);
  }
  return Math.min(value, 8);
}
