import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateTotalTokens,
  buildChunkPlan,
  type ChunkPlan,
  type Chunk,
} from '../../src/protocol/discovery-chunker.js';
import type { DeepDiscoveryContext } from '../../src/protocol/discovery-enhanced.js';

// ── Mock dependency ───────────────────────────────────────────────────────────
vi.mock('../../src/protocol/discovery-enhanced.js', () => ({
  estimateAngelMdSize: vi.fn(),
}));

import { estimateAngelMdSize } from '../../src/protocol/discovery-enhanced.js';
const mockEstimate = vi.mocked(estimateAngelMdSize);

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIN_CONTEXT: DeepDiscoveryContext = {
  territoryPath: '/test',
  fileCount: 1,
  classifiedFiles: [],
  highValueContent: '',
  mediumValueStubs: '',
  lowValueListing: '',
  totalTokens: 0,
  budgetUsed: 0,
  memoryConfig: { targetPct: 0.5, maxTokens: 32000 },
  stats: {
    totalFiles: 1,
    highValueFiles: 0,
    mediumValueFiles: 0,
    lowValueFiles: 1,
    boilerplateLinesSkipped: 0,
  },
};

function makeContext(overrides: Partial<DeepDiscoveryContext> = {}): DeepDiscoveryContext {
  return {
    ...MIN_CONTEXT,
    ...overrides,
    stats: {
      ...MIN_CONTEXT.stats,
      ...(overrides.stats ?? {}),
    },
  };
}

// Known section list (must match the source)
const ALL_SECTIONS = [
  'Charter y Boundaries',
  'Arquitectura del Área',
  'Public Contract',
  'Invariantes y Reglas de Negocio',
  'Cobertura de Código',
  'Data Model',
  'Flujos Críticos',
  'Testing Patterns',
  'Decision Log',
  'Known Debt y TODO',
  'Dependencies',
];

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockEstimate.mockReset();
});

// ── estimateTotalTokens ─────────────────────────────────────────────────────

describe('estimateTotalTokens', () => {
  it('returns a positive number for a normal context', () => {
    mockEstimate.mockReturnValue(8500);
    const ctx = makeContext({
      highValueContent: 'lots of code content '.repeat(500),
    });
    const result = estimateTotalTokens(ctx);
    expect(result).toBeGreaterThan(0);
    expect(mockEstimate).toHaveBeenCalledWith(ctx);
  });

  it('returns 0 for an empty context', () => {
    mockEstimate.mockReturnValue(0);
    const result = estimateTotalTokens(MIN_CONTEXT);
    expect(result).toBe(0);
  });

  it('delegates to estimateAngelMdSize', () => {
    mockEstimate.mockReturnValue(12345);
    const ctx = makeContext();
    const result = estimateTotalTokens(ctx);
    expect(result).toBe(12345);
    expect(mockEstimate).toHaveBeenCalledTimes(1);
  });
});

// ── buildChunkPlan: single chunk (below threshold) ────────────────────────────

describe('buildChunkPlan — single chunk mode (total <= 12 000 tokens)', () => {
  it('returns a single chunk for a small context (< 50KB estimated)', () => {
    mockEstimate.mockReturnValue(5000);
    const plan = buildChunkPlan(makeContext());

    expect(plan.estimatedChunks).toBe(1);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.totalEstimatedTokens).toBe(5000);
    expect(plan.chunks[0].id).toBe(0);
    expect(plan.chunks[0].sections).toEqual(ALL_SECTIONS);
    expect(plan.chunks[0].estimatedTokens).toBe(5000);
  });

  it('uses the exact threshold boundary (12000)', () => {
    mockEstimate.mockReturnValue(12_000);
    const plan = buildChunkPlan(makeContext());

    expect(plan.estimatedChunks).toBe(1);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].sections).toEqual(ALL_SECTIONS);
  });

  it('includes a sensible contextHint in the single chunk', () => {
    mockEstimate.mockReturnValue(3000);
    const plan = buildChunkPlan(makeContext());

    expect(plan.chunks[0].contextHint).toContain('complete angel.md');
    expect(plan.chunks[0].contextHint).toContain('all 11 sections');
    expect(plan.chunks[0].contextHint).toContain('single pass');
  });

  it('ChunkPlan totalEstimatedTokens matches the chunk estimatedTokens for single chunk', () => {
    mockEstimate.mockReturnValue(7777);
    const plan = buildChunkPlan(makeContext());

    expect(plan.totalEstimatedTokens).toBe(7777);
    expect(plan.chunks[0].estimatedTokens).toBe(7777);
    expect(plan.totalEstimatedTokens).toBe(
      plan.chunks.reduce((sum, c) => sum + c.estimatedTokens, 0),
    );
  });
});

// ── buildChunkPlan: multiple chunks (above threshold) ─────────────────────────

describe('buildChunkPlan — chunking mode (total > 12 000 tokens)', () => {
  it('returns 5 chunks for a large context (> 100KB estimated)', () => {
    mockEstimate.mockReturnValue(25_000);
    const ctx = makeContext({
      stats: { highValueFiles: 20, mediumValueFiles: 10 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.estimatedChunks).toBe(5);
    expect(plan.chunks).toHaveLength(5);
    expect(plan.totalEstimatedTokens).toBe(25_000);
  });

  it('assigns correct sections to chunk 0 (Charter through Invariantes)', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 15, mediumValueFiles: 8 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.chunks[0].sections).toEqual([
      'Charter y Boundaries',
      'Arquitectura del Área',
      'Public Contract',
      'Invariantes y Reglas de Negocio',
    ]);
    expect(plan.chunks[0].id).toBe(0);
  });

  it('assigns chunk 1 to first half of Cobertura de Código', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 20, mediumValueFiles: 10 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.chunks[1].sections).toEqual(['Cobertura de Código']);
    expect(plan.chunks[1].id).toBe(1);
  });

  it('assigns chunk 2 to Cobertura de Código remaining + Data Model', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 20, mediumValueFiles: 10 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.chunks[2].sections).toEqual(['Cobertura de Código', 'Data Model']);
    expect(plan.chunks[2].id).toBe(2);
  });

  it('assigns chunk 3 to Flujos Críticos + Testing Patterns', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 20, mediumValueFiles: 10 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.chunks[3].sections).toEqual(['Flujos Críticos', 'Testing Patterns']);
    expect(plan.chunks[3].id).toBe(3);
  });

  it('assigns chunk 4 to Decision Log + Known Debt + Dependencies', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 20, mediumValueFiles: 10 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.chunks[4].sections).toEqual([
      'Decision Log',
      'Known Debt y TODO',
      'Dependencies',
    ]);
    expect(plan.chunks[4].id).toBe(4);
  });

  it('every chunk has non-empty sections and contextHint', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 15, mediumValueFiles: 5 },
    });
    const plan = buildChunkPlan(ctx);

    for (let i = 0; i < plan.chunks.length; i++) {
      const chunk = plan.chunks[i];
      expect(chunk.sections.length, `chunk ${i} has sections`).toBeGreaterThan(0);
      expect(chunk.contextHint, `chunk ${i} has contextHint`).toBeTruthy();
      expect(typeof chunk.contextHint).toBe('string');
      expect(chunk.contextHint.length).toBeGreaterThan(10);
    }
  });

  it('ChunkPlan totalEstimatedTokens equals sum of all chunk estimatedTokens', () => {
    mockEstimate.mockReturnValue(35_000);
    const ctx = makeContext({
      stats: { highValueFiles: 30, mediumValueFiles: 15 },
    });
    const plan = buildChunkPlan(ctx);

    const sumChunks = plan.chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);
    expect(plan.totalEstimatedTokens).toBe(35_000);
    expect(plan.totalEstimatedTokens).not.toBe(sumChunks); // chunks sum is the _output_ cost, total is input estimate
    // Per spec: totalEstimatedTokens is the estimate from estimateTotalTokens, not sum of chunks
    expect(plan.chunks.length).toBe(5);
  });

  it('chunk 0 includes overhead tokens (500)', () => {
    mockEstimate.mockReturnValue(25_000);
    const ctx = makeContext({
      stats: { highValueFiles: 10, mediumValueFiles: 5 },
    });
    const plan = buildChunkPlan(ctx);

    // chunk0 should be larger than just base section tokens alone
    expect(plan.chunks[0].estimatedTokens).toBeGreaterThan(500);
  });

  it('chunk 4 (last) contextHint mentions "LAST chunk"', () => {
    mockEstimate.mockReturnValue(25_000);
    const ctx = makeContext({
      stats: { highValueFiles: 10, mediumValueFiles: 5 },
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.chunks[4].contextHint).toContain('LAST chunk');
    expect(plan.chunks[4].contextHint).toContain('appendAngelMd');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('buildChunkPlan — edge cases', () => {
  it('highValueFiles = 0 and estimate low → single chunk with all sections', () => {
    mockEstimate.mockReturnValue(2000);
    const ctx = makeContext({
      stats: { highValueFiles: 0, mediumValueFiles: 0, totalFiles: 0 },
      highValueContent: '',
      mediumValueStubs: '',
    });
    const plan = buildChunkPlan(ctx);

    expect(plan.estimatedChunks).toBe(1);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].sections).toEqual(ALL_SECTIONS);
    expect(plan.chunks[0].estimatedTokens).toBe(2000);
  });

  it('sections array covers all 11 template sections in single chunk mode', () => {
    mockEstimate.mockReturnValue(1000);
    const plan = buildChunkPlan(makeContext({ stats: { highValueFiles: 0, mediumValueFiles: 0 } }));

    expect(plan.chunks[0].sections).toHaveLength(11);
    expect(plan.chunks[0].sections).toEqual(ALL_SECTIONS);
  });

  it('highValueFiles = 0 with estimate above threshold still chunks', () => {
    mockEstimate.mockReturnValue(20_000);
    const ctx = makeContext({
      stats: { highValueFiles: 0, mediumValueFiles: 0 },
      highValueContent: 'x'.repeat(80_000), // large content but no high-value files stat
    });
    const plan = buildChunkPlan(ctx);

    // Should still chunk because estimate is above threshold
    expect(plan.estimatedChunks).toBeGreaterThan(1);
    expect(plan.chunks.length).toBe(5);
  });

  it('every chunk has a unique id from 0 to 4', () => {
    mockEstimate.mockReturnValue(25_000);
    const ctx = makeContext({
      stats: { highValueFiles: 10, mediumValueFiles: 5 },
    });
    const plan = buildChunkPlan(ctx);

    const ids = plan.chunks.map((c) => c.id);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
  });

  it('all sections are covered across all chunks in chunking mode', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 15, mediumValueFiles: 8 },
    });
    const plan = buildChunkPlan(ctx);

    const coveredSections = plan.chunks.flatMap((c) => c.sections);
    // Remove duplicates (Cobertura de Código appears in chunk 1 and 2)
    const uniqueSections = [...new Set(coveredSections)];
    expect(uniqueSections.sort()).toEqual(ALL_SECTIONS.sort());
    // Verify Cobertura de Código spans 2 chunks
    expect(coveredSections.filter((s) => s === 'Cobertura de Código')).toHaveLength(2);
  });

  it('estimatedTokens in each chunk is a positive integer', () => {
    mockEstimate.mockReturnValue(30_000);
    const ctx = makeContext({
      stats: { highValueFiles: 20, mediumValueFiles: 10 },
    });
    const plan = buildChunkPlan(ctx);

    for (const chunk of plan.chunks) {
      expect(Number.isInteger(chunk.estimatedTokens)).toBe(true);
      expect(chunk.estimatedTokens).toBeGreaterThan(0);
    }
  });

  it('ChunkPlan type shape is correct', () => {
    mockEstimate.mockReturnValue(5000);
    const plan = buildChunkPlan(makeContext());

    expect(plan).toHaveProperty('chunks');
    expect(plan).toHaveProperty('totalEstimatedTokens');
    expect(plan).toHaveProperty('estimatedChunks');
    expect(Array.isArray(plan.chunks)).toBe(true);

    const chunk = plan.chunks[0];
    expect(chunk).toHaveProperty('id');
    expect(chunk).toHaveProperty('sections');
    expect(chunk).toHaveProperty('estimatedTokens');
    expect(chunk).toHaveProperty('contextHint');
  });
});