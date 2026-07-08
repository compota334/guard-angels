import { describe, it, expect } from 'vitest';
import { mapWithConcurrency, clampParallel } from '../../src/util/concurrency.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('processes all items and preserves input order', async () => {
    const items = [5, 1, 4, 2, 3];
    const results = await mapWithConcurrency(items, 2, async (n) => {
      await delay(n);
      return n * 10;
    });

    expect(results.map((r) => (r as PromiseFulfilledResult<number>).value)).toEqual([
      50, 10, 40, 20, 30,
    ]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active--;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('slides the window: a slow item does not block the rest', async () => {
    const completed: number[] = [];
    await mapWithConcurrency([50, 5, 5, 5], 2, async (ms, i) => {
      await delay(ms);
      completed.push(i);
    });

    // With a batch barrier, item 0 (50ms) would hold back items 2 and 3.
    // With a sliding window, the fast items all finish before the slow one.
    expect(completed[completed.length - 1]).toBe(0);
  });

  it('captures rejections per item without cancelling the rest', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(results[2].status).toBe('fulfilled');
  });

  it('handles an empty item list', async () => {
    const results = await mapWithConcurrency([], 4, async () => 1);
    expect(results).toEqual([]);
  });
});

describe('clampParallel', () => {
  it('returns the fallback when undefined', () => {
    expect(clampParallel(undefined, 4)).toBe(4);
  });

  it('caps at 8', () => {
    expect(clampParallel(20, 4)).toBe(8);
  });

  it('passes through values in range', () => {
    expect(clampParallel(2, 4)).toBe(2);
  });

  it('throws on zero, negative, and non-integer values', () => {
    expect(() => clampParallel(0, 4)).toThrow(/positive integer/);
    expect(() => clampParallel(-1, 4)).toThrow(/positive integer/);
    expect(() => clampParallel(2.5, 4)).toThrow(/positive integer/);
  });
});
