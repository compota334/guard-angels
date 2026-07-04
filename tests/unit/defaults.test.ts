import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveMemoryConfig } from '../../src/config/defaults.js';

describe('resolveMemoryConfig', () => {
  it('applies the default 25% when memory is undefined', () => {
    expect(resolveMemoryConfig(undefined, 100_000)).toEqual({
      targetPct: 25,
      maxTokens: 25_000,
    });
  });

  it('lets max_tokens override target_pct entirely (targetPct becomes 0)', () => {
    expect(resolveMemoryConfig({ target_pct: 50, max_tokens: 8000 }, 100_000)).toEqual({
      targetPct: 0,
      maxTokens: 8000,
    });
    expect(resolveMemoryConfig({ max_tokens: 3000 }, 100_000)).toEqual({
      targetPct: 0,
      maxTokens: 3000,
    });
  });

  it('derives maxTokens from target_pct against the context window', () => {
    expect(resolveMemoryConfig({ target_pct: 10 }, 100_000)).toEqual({
      targetPct: 10,
      maxTokens: 10_000,
    });
  });

  it('floors fractional token budgets', () => {
    expect(resolveMemoryConfig({ target_pct: 33 }, 101)).toEqual({
      targetPct: 33,
      maxTokens: 33,
    });
  });

  it('falls back to the default target_pct when the config omits it', () => {
    expect(resolveMemoryConfig({}, 100_000)).toEqual({
      targetPct: 25,
      maxTokens: 25_000,
    });
  });
});

describe('DEFAULT_PROMPT_WARN_BYTES', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWithEnv(value: string | undefined): Promise<number> {
    vi.resetModules();
    if (value === undefined) {
      vi.stubEnv('GUARD_ANGELS_PROMPT_WARN_BYTES', undefined as unknown as string);
    } else {
      vi.stubEnv('GUARD_ANGELS_PROMPT_WARN_BYTES', value);
    }
    const mod = await import('../../src/config/defaults.js');
    return mod.DEFAULT_PROMPT_WARN_BYTES;
  }

  it('defaults to 80000 when the env var is unset or empty', async () => {
    expect(await loadWithEnv(undefined)).toBe(80_000);
    expect(await loadWithEnv('')).toBe(80_000);
  });

  it('accepts a valid numeric override', async () => {
    expect(await loadWithEnv('12345')).toBe(12_345);
  });

  it('throws on a non-numeric override', async () => {
    await expect(loadWithEnv('abc')).rejects.toThrow(
      /Invalid GUARD_ANGELS_PROMPT_WARN_BYTES/,
    );
  });

  it('throws on zero or negative overrides', async () => {
    await expect(loadWithEnv('0')).rejects.toThrow(
      /Invalid GUARD_ANGELS_PROMPT_WARN_BYTES/,
    );
    await expect(loadWithEnv('-5')).rejects.toThrow(
      /Invalid GUARD_ANGELS_PROMPT_WARN_BYTES/,
    );
  });
});
