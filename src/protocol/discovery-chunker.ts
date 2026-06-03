/**
 * Fase 4: Chunked Writing — Planificador de chunks para angel.md grandes.
 *
 * Cuando el angel.md estimado es >50KB (~65K tokens), no se puede escribir
 * en una sola invocación. Este módulo divide la generación en N chunks de
 * ~50K tokens cada uno, escritos secuencialmente con append.
 */

import type { DeepDiscoveryContext } from './discovery-enhanced.js';
import { estimateAngelMdSize } from './discovery-enhanced.js';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ChunkPlan {
  chunks: Chunk[];
  totalEstimatedTokens: number;
  estimatedChunks: number;
}

export interface Chunk {
  id: number;            // 0, 1, 2...
  sections: string[];    // nombres de secciones a generar en este chunk
  estimatedTokens: number; // estimación de tokens de output
  contextHint: string;   // qué contexto específico darle al angel
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Las 11 secciones del template en orden.
 */
const ALL_SECTIONS: string[] = [
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

/**
 * Umbral: si el angel.md estimado supera este valor en tokens, se activa chunking.
 * 50KB ≈ 51200 chars. A ~4 chars/token → ~12800 tokens. Usamos 12000 como threshold
 * conservador para trigger temprano.
 */
const CHUNK_THRESHOLD_TOKENS = 12_000;

/**
 * Overhead estimado por chunk para estructura (headers, separadores, frontmatter re-escritura).
 */
const OVERHEAD_TOKENS_PER_CHUNK = 500;

/**
 * Estimación base de tokens para cada sección (sin contar cobertura de código, que es dinámica).
 * Estos valores se ajustan proporcionalmente al budget real del deep context.
 */
const BASE_SECTION_TOKENS: Record<string, number> = {
  'Charter y Boundaries': 600,
  'Arquitectura del Área': 800,
  'Public Contract': 1200,
  'Invariantes y Reglas de Negocio': 800,
  'Cobertura de Código': 0, // dinámico — ver computeCodeCoverageTokens
  'Data Model': 1200,
  'Flujos Críticos': 1000,
  'Testing Patterns': 600,
  'Decision Log': 400,
  'Known Debt y TODO': 400,
  'Dependencies': 300,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Estimar tokens de la sección "Cobertura de Código" basado en cantidad de
 * archivos high-value y medium-value.
 *
 * Regla: ~200 tokens por archivo high-value, ~80 por medium-value.
 */
function computeCodeCoverageTokens(ctx: DeepDiscoveryContext): number {
  const highCount = ctx.stats.highValueFiles;
  const mediumCount = ctx.stats.mediumValueFiles;
  return highCount * 200 + mediumCount * 80;
}

/**
 * Calcular tokens totales excluyendo cobertura de código (secciones fijas).
 */
function computeFixedSectionsTokens(scaleFactor: number): number {
  let total = 0;
  for (const [section, base] of Object.entries(BASE_SECTION_TOKENS)) {
    if (section !== 'Cobertura de Código') {
      total += Math.round(base * scaleFactor);
    }
  }
  return total + OVERHEAD_TOKENS_PER_CHUNK; // overhead para el primer chunk
}

// ─── Funciones Públicas ──────────────────────────────────────────────────────

/**
 * Estimar tokens totales del angel.md basado en el deep discovery context.
 *
 * Usa estimateAngelMdSize() de discovery-enhanced.ts como base, que considera:
 * - High value content → ~60% token count
 * - Medium value stubs → ~40% token count
 * - Structure overhead → ~1250 tokens
 *
 * @param deepContext - Contexto de descubrimiento profundo
 * @returns Tokens estimados del angel.md completo
 */
export function estimateTotalTokens(deepContext: DeepDiscoveryContext): number {
  return estimateAngelMdSize(deepContext);
}

/**
 * Construir un plan de chunks para escribir un angel.md grande.
 *
 * Si el tamaño estimado es < 50KB (~12K tokens), devuelve un solo chunk
 * (sin chunking). Si es >= 50KB, divide las 11 secciones en 5 chunks
 * de ~40-50K tokens cada uno.
 *
 * @param deepContext - Contexto de descubrimiento profundo
 * @returns Plan de chunks con metadatos
 */
export function buildChunkPlan(deepContext: DeepDiscoveryContext): ChunkPlan {
  const totalEstimatedTokens = estimateTotalTokens(deepContext);

  // Si es menor al umbral, un solo chunk (sin chunking)
  if (totalEstimatedTokens <= CHUNK_THRESHOLD_TOKENS) {
    return {
      chunks: [
        {
          id: 0,
          sections: [...ALL_SECTIONS],
          estimatedTokens: totalEstimatedTokens,
          contextHint:
            'Write the complete angel.md with all 11 sections in a single pass. ' +
            'Use the full discovery context below. Write the body to angel.md directly.',
        },
      ],
      totalEstimatedTokens,
      estimatedChunks: 1,
    };
  }

  // Chunking mode: dividir las 11 secciones
  const highFileCount = deepContext.stats.highValueFiles;
  const mediumFileCount = deepContext.stats.mediumValueFiles;
  const codeCoverageTokens = computeCodeCoverageTokens(deepContext);
  const halfCodeCoverage = Math.ceil(codeCoverageTokens / 2);

  // Factor de escala para ajustar las secciones fijas al budget real
  const fixedTokens = computeFixedSectionsTokens(1.0); // sin incluir cobertura
  const scaleFactor = Math.max(
    0.5,
    Math.min(2.0, (totalEstimatedTokens - codeCoverageTokens) / Math.max(fixedTokens, 1)),
  );

  const chunk0Tokens = Math.round(
    (BASE_SECTION_TOKENS['Charter y Boundaries'] +
      BASE_SECTION_TOKENS['Arquitectura del Área'] +
      BASE_SECTION_TOKENS['Public Contract'] +
      BASE_SECTION_TOKENS['Invariantes y Reglas de Negocio']) *
      scaleFactor +
      OVERHEAD_TOKENS_PER_CHUNK,
  );

  const dataModelTokens = Math.round(BASE_SECTION_TOKENS['Data Model'] * scaleFactor);
  const flowsTokens = Math.round(BASE_SECTION_TOKENS['Flujos Críticos'] * scaleFactor);
  const testingTokens = Math.round(BASE_SECTION_TOKENS['Testing Patterns'] * scaleFactor);
  const decisionTokens = Math.round(BASE_SECTION_TOKENS['Decision Log'] * scaleFactor);
  const debtTokens = Math.round(BASE_SECTION_TOKENS['Known Debt y TODO'] * scaleFactor);
  const depsTokens = Math.round(BASE_SECTION_TOKENS['Dependencies'] * scaleFactor);

  const chunks: Chunk[] = [
    {
      id: 0,
      sections: [
        'Charter y Boundaries',
        'Arquitectura del Área',
        'Public Contract',
        'Invariantes y Reglas de Negocio',
      ],
      estimatedTokens: chunk0Tokens,
      contextHint:
        `Generate sections: Charter y Boundaries, Arquitectura del Área, Public Contract, Invariantes y Reglas de Negocio. ` +
        `Use the file listing and architecture overview from the discovery context. ` +
        `Do NOT include other sections. Use appendAngelMd() to write. ` +
        `This is the FIRST chunk — no previous sections exist.`,
    },
    {
      id: 1,
      sections: ['Cobertura de Código'],
      estimatedTokens: halfCodeCoverage + OVERHEAD_TOKENS_PER_CHUNK,
      contextHint:
        `Generate ONLY the Cobertura de Código section for the first ~${Math.ceil(highFileCount * 0.5)} high-value files ` +
        `and ~${Math.ceil(mediumFileCount * 0.5)} medium-value files. ` +
        `Use the high-value file contents from the discovery context. ` +
        `Do NOT repeat sections already written in chunk 0. Use appendAngelMd() to append.`,
    },
    {
      id: 2,
      sections: ['Cobertura de Código', 'Data Model'],
      estimatedTokens: (codeCoverageTokens - halfCodeCoverage) + dataModelTokens + OVERHEAD_TOKENS_PER_CHUNK,
      contextHint:
        `Generate the remaining Cobertura de Código entries (remaining files not covered in chunk 1) ` +
        `and the Data Model section (schemas, types, relationships). ` +
        `Do NOT repeat sections already written. Use appendAngelMd() to append.`,
    },
    {
      id: 3,
      sections: ['Flujos Críticos', 'Testing Patterns'],
      estimatedTokens: flowsTokens + testingTokens + OVERHEAD_TOKENS_PER_CHUNK,
      contextHint:
        `Generate the Flujos Críticos section (critical call flows and state machines) ` +
        `and the Testing Patterns section (test runner, fixtures, mocks, coverage goals). ` +
        `Do NOT repeat sections already written. Use appendAngelMd() to append.`,
    },
    {
      id: 4,
      sections: ['Decision Log', 'Known Debt y TODO', 'Dependencies'],
      estimatedTokens:
        decisionTokens + debtTokens + depsTokens + OVERHEAD_TOKENS_PER_CHUNK,
      contextHint:
        `Generate the Decision Log (append-only entries), Known Debt y TODO (bugs, optimizations, tech debt), ` +
        `and Dependencies (inter-angel relationships). ` +
        `This is the LAST chunk. After writing, verify all 11 sections are present and complete in the final file. ` +
        `Do NOT repeat sections already written. Use appendAngelMd() to append.`,
    },
  ];

  return {
    chunks,
    totalEstimatedTokens,
    estimatedChunks: chunks.length,
  };
}