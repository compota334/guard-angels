# Rediseño del Pipeline de Generación de angel.md

> **Fecha**: 2026-06-03
> **Autor**: Análisis automatizado del código fuente
> **Estado**: Implementado

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Análisis del Pipeline Actual](#2-análisis-del-pipeline-actual)
3. [Cuellos de Botella Identificados](#3-cuellos-de-botella-identificados)
4. [Rediseño Propuesto](#4-rediseño-propuesto)
   - 4.1 [Config: angel_memory_target_pct y angel_max_tokens](#41-config-angel_memory_target_pct-y-angel_max_tokens)
   - 4.2 [Nuevo Template: Secciones Densas](#42-nuevo-template-secciones-densas)
   - 4.3 [Enhanced Discovery: Deep Reader](#43-enhanced-discovery-deep-reader)
   - 4.4 [Direct Write: angel.md sin PROPOSED PLAN](#44-direct-write-angelmd-sin-proposed-plan)
   - 4.5 [Chunked Writing para angel.md Grandes](#45-chunked-writing-para-angelmd-grandes)
   - 4.6 [Boilerplate Skipper](#46-boilerplate-skipper)
5. [Cambios Concretos a Archivos](#5-cambios-concretos-a-archivos)
   - 5.1 `src/config/schema.ts`
   - 5.2 `src/config/defaults.ts`
   - 5.3 `src/config/load.ts`
   - 5.4 `src/protocol/discovery.ts` → `src/protocol/discovery-enhanced.ts`
   - 5.5 `src/angels/draft.ts` → `src/angels/template.ts`
   - 5.6 `src/protocol/prompt.ts`
   - 5.7 `src/protocol/response.ts`
   - 5.8 `src/angels/memory.ts`
   - 5.9 `src/commands/onboard.ts`
   - 5.10 `src/protocol/orchestrate.ts`
   - 5.11 `src/config/schema.ts` (AngelFrontmatter extendido)
   - 5.12 Nuevo: `src/protocol/discovery-filters.ts`
   - 5.13 Nuevo: `src/protocol/discovery-chunker.ts`
6. [Diagrama de Flujo: Antes vs Después](#6-diagrama-de-flujo-antes-vs-después)
7. [Estimación de Impacto](#7-estimación-de-impacto)
8. [Risks y Mitigaciones](#8-risks-y-mitigaciones)
9. [Roadmap de Implementación](#9-roadmap-de-implementación)

---

## 1. Resumen Ejecutivo

El pipeline actual de generación de `angel.md` tiene **tres cuellos de botella fundamentales** que impiden generar memorias densas de ~250K tokens:

1. **DISCOVERYContext**: limitado a 50KB total (10 archivos, 5KB c/u, 200 líneas)
2. **PROPOSED PLAN**: campo único en el response file, sin soporte para escritura directa ni chunking
3. **Template**: 6 secciones genéricas sin cobertura detallada de código, data model, flujos críticos ni testing patterns

Este documento propone un rediseño completo del pipeline, con cambios concretos a **11 archivos existentes** y **3 archivos nuevos**. El rediseño es **100% backward compatible**: los proyectos existentes siguen funcionando, pero pueden optar incrementalmente por las nuevas capacidades mediante la config.

---

## 2. Análisis del Pipeline Actual

### Flujo Actual de DISCOVERY

```
onboard.ts
  ├── buildDiscoveryContext(path, depth=3)
  │     ├── buildRecursiveListing() → fileListing (max 500 líneas)
  │     └── Priority file scan:
  │           ├── MAX_PRIORITY_CHARS = 51200 (50 KB total)
  │           ├── MAX_FILE_SNIPPET_CHARS = 5120 (5 KB por archivo)
  │           ├── MAX 10 archivos
  │           └── Sólo 200 líneas por archivo
  │
  ├── writeBrief() → Escribe brief con context de ~50 KB
  ├── invoke() → Llama al backend con el prompt
  │     └── buildPrompt() → Prompt con [BRIEF] section conteniendo el context
  │
  ├── parseResponse() → Extrae PROPOSED PLAN del response file
  └── writeAngelMd() → Escribe body = PROPOSED PLAN.trim()
```

### Formato del Response File

```
FROM: src-auth
TIMESTAMP: 2026-05-12T14:32:00.000Z
RESPONSE: done

CONCERNS:
...

PROPOSED PLAN:
## Charter
...
## Public contract
...
## Invariants
...
(EL CUERPO COMPLETO DEL angel.md VA AQUÍ)

QUESTIONS FOR MAIN:
...
```

### Template Actual (en `draft.ts`)

| Sección | Propósito |
|---------|-----------|
| Charter | Qué posee el folder |
| Public contract | Exports/API surface |
| Invariants | Reglas que no deben violarse |
| Decision log | Append-only de decisiones |
| Open questions / known debt | Deudas técnicas |
| Dependencies | Relaciones con otros angels |

**Ausencias notables**: Code coverage, Data model, Critical flows, Testing patterns.

---

## 3. Cuellos de Botella Identificados

### 3.1 DISCOVERYContext ridículamente pequeño

| Límite | Valor | Para 250K tokens de output | Ratio |
|--------|-------|---------------------------|-------|
| Total priority files | 50 KB | Necesita leer ~1-5 MB | ~20-100x |
| Por archivo | 5 KB / 200 líneas | Archivos típicos: 500-5000 líneas | ~5-25x |
| Archivos totales | 10 | Área típica: 20-200 archivos | ~2-20x |

**Problema**: El angel no puede generar cobertura densa de código si no ve más que snippets de 200 líneas. El `(truncated)` notice le avisa que hay más, pero no tiene acceso.

### 3.2 PROPOSED PLAN es un cuello de botella de tamaño

- **El response file** es un único archivo de texto plano. Si el angel escribe 250K tokens (~1MB) en PROPOSED PLAN, el backend debe generarlo completo en memoria y escribirlo al disco.
- **`extractSection()`** busca `"PROPOSED PLAN:\n"` y captura todo hasta el siguiente header (`QUESTIONS FOR MAIN:\n`). Funciona para cualquier tamaño, pero:
  - No hay feedback progresivo — si el timeout ocurre a los 30 segundos, se pierde todo.
  - Backends como Claude Desktop o Codex tienen límites de output (~4K-8K tokens para respuestas estructuradas).
- **`onboard.ts` línea 65**: `result.response.proposedPlan.trim()` — lee todo en memoria. 250K tokens ~1MB de string, en Node.js son ~1.5GB de heap. No es ideal pero funciona. El problema real es que el backend *genera* el texto y lo escribe en el response file, y muchos backends truncarían o fallarían antes.

### 3.3 Sin filtrado de boilerplate

`discovery.ts` lee archivos crudos. Si un archivo TypeScript empieza con 50 líneas de imports estándar (`import { readFileSync } from 'node:fs'`), esas 50 líneas consumen ~10% del budget de 5KB sin aportar información útil.

### 3.4 Sin tamaño configurable

No existe `angel_memory_target_pct` ni `angel_max_tokens` en el schema de configuración. El angel no sabe *cuán denso* debe ser su angel.md. La instrucción en el prompt es genérica: "Write a complete angel.md body".

### 3.5 Template incompleto

Faltan las secciones que harían que un angel.md de 250K tokens sea útil:
- **Code coverage**: resumen de cada módulo, su lógica, edge cases
- **Data model**: schemas, tipos, interfaces
- **Critical flows**: secuencias de llamadas, state machines
- **Testing patterns**: cómo se testea, fixtures, mocks

### 3.6 Escritura indirecta

El angel está explícitamente instruido a **no escribir angel.md directamente** durante DISCOVERY:
```
"Do NOT write angel.md directly — put it here."
```
Esto fuerza que todo el contenido pase por el response file → `parseResponse()` → `writeAngelMd()`. Para contenidos grandes, esto es una limitación artificial.

---

## 4. Rediseño Propuesto

### 4.1 Config: `angel_memory_target_pct` y `angel_max_tokens`

**Archivos**: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/load.ts`

Se agregan dos nuevos campos opcionales al schema de configuración:

```typescript
const MemoryConfigSchema = z.object({
  target_pct: z.number().min(1).max(100).optional().default(25),
  max_tokens: z.number().int().positive().optional(),
  // Si ambos están presentes, max_tokens tiene prioridad
});
```

Y se extiende `ConfigSchema`:

```typescript
export const ConfigSchema = z.object({
  version: z.literal(1),
  backend: BackendSchema,
  angels: z.array(AngelEntrySchema).min(1),
  sweep: SweepSchema,
  global_notes: z.string().optional(),
  memory: MemoryConfigSchema.optional().default({ target_pct: 25 }),
});
```

**En `_config.yml`**:
```yaml
memory:
  target_pct: 25           # 25% del context window
  # max_tokens: 250000     # prioridad sobre target_pct si se especifica
```

**Per-angel override**: Se agrega `memory` opcional a `AngelEntrySchema`:

```typescript
const AngelEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['root', 'folder']),
  path: z.string().min(1),
  memory: MemoryConfigSchema.optional(),
});
```

### 4.2 Nuevo Template: Secciones Densas

**Archivo nuevo**: `src/angels/template.ts` (reemplaza funcionalidad de `draft.ts`)

Template rediseñado con **11 secciones** en vez de 6:

```
# Angel: {path} ({type})

## Charter y Boundaries
- **Owns**: lista de responsabilidades explícitas
- **Does NOT own**: lista de exclusiones (con referencias a qué angel lo posee)
- **Scope boundaries**: archivos/directorios que están en el territorio pero NO son de su responsabilidad

## Arquitectura del Área
- **Diagrama de componentes** (ASCII/textual): 
  ```
  ┌──────────┐     ┌──────────┐
  │ module-a │────▶│ module-b │
  └──────────┘     └──────────┘
       │                 │
       ▼                 ▼
  ┌──────────┐     ┌──────────┐
  │ module-c │     │ module-d │
  └──────────┘     └──────────┘
  ```
- **Flujo de datos**: cómo circula la información entre módulos
- **Patrón arquitectónico**: MVC, layered, hexagonal, etc.

## Public Contract
- **Exports**: lista de todo lo que se exporta públicamente con firmas
- **API surface**: endpoints, handlers, métodos públicos
- **Tipos públicos**: interfaces, types, enums exportados
- **Eventos emitidos**: qué eventos/notificaciones produce
- **Configuración aceptada**: environment variables, flags, settings

## Invariantes y Reglas de Negocio
- **Invariantes**: reglas que NUNCA deben violarse (validación estricta)
- **Business rules**: reglas que DEBEN cumplirse (validación en código)
- **Precondiciones**: qué debe ser verdad antes de llamar a X
- **Postcondiciones**: qué debe ser verdad después de llamar a X
- **Reglas de consistencia**: relaciones entre datos que deben mantenerse

## Cobertura de Código (por archivo/módulo)

Para CADA archivo del área (NO imports estándar, NO boilerplate):

### `path/to/file.ts`
- **Propósito**: una línea de qué hace
- **Lógica interna**: descripción densa de la implementación
- **Edge cases**: casos borde conocidos
- **Dependencias internas**: qué funciones/módulos del área usa
- **Dependencias externas**: qué librerías npm/pip/etc. usa (solo las relevantes)
- **Notas**: gotchas, optimizaciones, deuda

### `path/to/other.ts`
...

## Data Model

### Schemas / Tipos
```typescript
interface User {
  id: string;        // UUID v4, primary key
  email: string;     // validated, unique
  role: 'admin' | 'user';
}
```

### Relaciones
- User 1──N Session
- Session N──1 Device

### State Machines / Enums
```
OrderState: pending → confirmed → shipped → delivered
                 ↘ cancelled
```

## Flujos Críticos

### Flujo: Login
1. `POST /api/login` → `authHandler()`
2. `validateCredentials()` → check email + password hash
3. `createSession()` → generate JWT, store in Redis
4. Return `{ token, user }`

### State Machines
```
Session:
  active → expired (TTL: 24h)
       → revoked (admin action)
       → refreshed (new token issued)
```

## Testing Patterns
- **Test runner**: vitest / jest / pytest
- **Fixtures**: `test/fixtures/users.json` — usuarios predefinidos
- **Mocks**: `vi.mock('../../db')` — base de datos mockeada
- **Factories**: `buildUser(overrides)` — factory functions
- **Coverage goals**: qué se espera cubrir en unit vs integration
- **Test commands**: `npm test`, `npm run test:e2e`

## Decision Log (append-only)
Cada entrada:
| Fecha | Decisión | Contexto | Alternativas Rechazadas | Consecuencias |
|-------|----------|----------|------------------------|---------------|

## Known Debt y TODO
- **Bugs conocidos**: issues con referencias
- **Optimizaciones pendientes**: qué y por qué
- **Refactors planeados**: cuándo y cómo
- **Tech debt**: código que debería mejorarse

## Dependencias
- **Angels que necesito**: ID → charter sumario
- **Angels que me necesitan**: ID → qué consumen de mí
```

### 4.3 Enhanced Discovery: Deep Reader

**Archivo**: `src/protocol/discovery.ts` → refactorizado como `src/protocol/discovery-enhanced.ts` + `src/protocol/discovery-filters.ts` + `src/protocol/discovery-chunker.ts`

#### Estrategia de Deep Reading

En vez de leer 5KB de cada archivo, el nuevo pipeline:

1. **Fase 1: Scan rápido** — lista completa de archivos con metadata (líneas, tamaño, extensión)
2. **Fase 2: Clasificación** — cada archivo se etiqueta:
   - `high_value`: lógica de negocio, tipos personalizados, tests
   - `medium_value`: config, utils, helpers
   - `low_value`: boilerplate de framework, re-exports, barrel files
   - `skip`: estándar (node_modules, dist, etc.)
3. **Fase 3: Lectura profunda** — para `high_value`:
   - Sin límite de líneas (lee el archivo completo)
   - Pero FILTRA: elimina imports estándar, decoradores de framework, JSDoc vacío
   - Target: ~80% del budget de context del DISCOVERY
4. **Fase 4: Lectura media** — para `medium_value`:
   - Lee primeras 100 líneas + últimas 50 líneas (firma + exports)
   - Target: ~15% del budget
5. **Fase 5: Stubs** — para `low_value`:
   - Solo nombre del archivo y exports list
   - Target: ~5% del budget

#### Configuración de Budget

El budget total de DISCOVERY se calcula dinámicamente:

```typescript
function computeDiscoveryBudget(config: Config): number {
  if (config.memory?.max_tokens) {
    // Asumimos ~4 chars/token para texto en inglés
    return config.memory.max_tokens * 4;
  }
  // Si no hay max_tokens, usamos target_pct contra un default
  // de 1M tokens (~4M chars) para Claude Opus
  const DEFAULT_CONTEXT_CHARS = 4_000_000; // ~1M tokens
  const pct = config.memory?.target_pct ?? 25;
  return Math.floor(DEFAULT_CONTEXT_CHARS * (pct / 100));
}
```

### 4.4 Direct Write: angel.md sin PROPOSED PLAN

**Cambio fundamental**: Durante DISCOVERY, el angel **escribe directamente** su `angel.md` y solo reporta `done` en el response.

#### Nuevo Flujo de DISCOVERY

```
onboard.ts
  1. buildDiscoveryContext() → context DENSO (configurable, hasta ~250K tokens)
  
  2. writeBrief() → brief con:
     - El context profundo
     - Instrucción: "Write your angel.md directly at {path}. 
       You have {maxTokens} tokens budget. Cover ALL sections.
       When done, write RESPONSE: done."
  
  3. invoke() → backend recibe prompt con:
     - [BRIEF] contiene el context y la instrucción de escritura directa
     - [OUTPUT INSTRUCTIONS] dice: "Write angel.md at {path}, 
       then write response file at {responsePath} with RESPONSE: done"
  
  4. El backend:
     a. Escribe angel.md directamente (en partes si es necesario)
     b. Escribe response file con RESPONSE: done
  
  5. onboard.ts verifica:
     - Existe response file con RESPONSE: done
     - Existe angel.md con frontmatter válido
     - Ajusta frontmatter (status, last_updated, last_updated_by)
  
  6. (Opcional) Si el angel.md está incompleto, el orchestrator
     puede invocar al angel nuevamente para continuar
```

#### Prompt Changes para Direct Write

En `prompt.ts`, las instrucciones de DISCOVERY cambian de:

```
"Put the angel.md body in PROPOSED PLAN. Do NOT write angel.md directly."
```

A:

```
"Write your angel.md directly at the path shown in [ANGEL IDENTITY]. 
You have approximately {maxChars} characters of budget for the angel.md body.
Cover all sections from the template. Be dense — skip standard imports,
framework decorators, and obvious boilerplate.

For very large angel.md content, you may write it in chunks:
1. Write angel.md content to {angelMdPath}
2. Write response file at {responsePath}
3. The orchestrator will verify and may invoke you again if needed.

ALWAYS write the response file last, with RESPONSE: done, after 
angel.md is fully written."
```

### 4.5 Chunked Writing para angel.md Grandes

**Problema**: Un solo backend invocation puede no ser suficiente para generar 250K tokens.

**Solución**: Sistema de **append-by-invocation** para angel.md.

#### Cómo funciona

1. El `onboard.ts` calcula el target size (ej: 250K tokens).
2. Divide el trabajo en **N chunks** (ej: 5 chunks de 50K tokens).
3. Cada chunk se genera en una invocación independiente.
4. Cada invocación escribe `angel.md` como append (no overwrite).
5. Secciones pre-asignadas a chunks:
   - Chunk 1: Charter + Boundaries + Arquitectura
   - Chunk 2: Public Contract + Invariantes
   - Chunk 3: Code Coverage (archivos 1-10)
   - Chunk 4: Code Coverage (archivos 11+) + Data Model
   - Chunk 5: Critical Flows + Testing + Decision Log + Debt + Dependencies

#### Implementación

**Archivo nuevo**: `src/protocol/discovery-chunker.ts`

```typescript
export interface ChunkPlan {
  totalChunks: number;
  targetTokensPerChunk: number;
  sections: ChunkSection[];
}

export interface ChunkSection {
  chunkIndex: number;
  sections: string[]; // ['charter', 'architecture', ...]
  totalFiles: number; // for code coverage chunks
  fileRange?: { start: number; end: number };
}

export function buildChunkPlan(
  targetTokens: number,
  files: string[],
  maxOutputTokens: number, // backend output limit
): ChunkPlan {
  const chunks = Math.ceil(targetTokens / maxOutputTokens);
  // ... asignación de secciones a chunks
}
```

**En `memory.ts`**, se agrega `appendAngelMd()`:

```typescript
export function appendAngelMd(filePath: string, newBody: string): void {
  // Si el archivo no existe, escribe frontmatter + body
  // Si existe, parsea frontmatter, hace append al body existente,
  // y reescribe con el frontmatter original
}
```

### 4.6 Boilerplate Skipper

**Archivo nuevo**: `src/protocol/discovery-filters.ts`

Filtros inteligentes que operan durante la lectura de archivos:

```typescript
export interface FileReadResult {
  content: string;
  filteredLines: number; // cuántas líneas se saltaron
  valueClassification: 'high' | 'medium' | 'low';
}

/**
 * Filtra contenido no informativo de un archivo fuente.
 */
export function filterBoilerplate(
  rawContent: string,
  fileExtension: string,
): FileReadResult {
  const lines = rawContent.split('\n');
  const filtered: string[] = [];
  let filteredCount = 0;
  
  for (const line of lines) {
    // Saltar imports estándar de Node.js
    if (isStandardNodeImport(line)) { filteredCount++; continue; }
    
    // Saltar imports de librerías de framework conocidas
    if (isFrameworkBoilerplate(line, fileExtension)) { filteredCount++; continue; }
    
    // Saltar JSDoc vacío o trivial
    if (isTrivialJsDoc(line)) { filteredCount++; continue; }
    
    // Saltar decoradores de framework (ej: @Component, @Injectable)
    if (isFrameworkDecoration(line)) { filteredCount++; continue; }
    
    // Saltar líneas de configuración de framework (ej: "type": "module")
    if (isConfigBoilerplate(line, fileExtension)) { filteredCount++; continue; }
    
    filtered.push(line);
  }
  
  return {
    content: filtered.join('\n'),
    filteredLines: filteredCount,
    valueClassification: classifyFileValue(rawContent, fileExtension),
  };
}
```

#### Reglas de Filtrado por Lenguaje

| Lenguaje | Import Estándar | Framework Boilerplate | Trivial |
|----------|----------------|----------------------|---------|
| TypeScript | `import.*from 'node:*'` | Decoradores Angular/NestJS | `export {}` |
| Python | `import os`, `import sys` | `@app.route()`, `@pytest.fixture` | `pass` |
| Rust | `use std::*` | `#[derive()]` comunes | `()` |
| Go | `import "fmt"`, `import "os"` | `func main()` wrapper | `_ =` |

---

## 5. Cambios Concretos a Archivos

### 5.1 `src/config/schema.ts`

**Cambio**: Agregar `MemoryConfigSchema` y extender `ConfigSchema` + `AngelEntrySchema`.

```typescript
// NUEVO
export const MemoryConfigSchema = z.object({
  target_pct: z.number().min(1).max(100).optional().default(25),
  max_tokens: z.number().int().positive().optional(),
});

// MODIFICADO
const AngelEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['root', 'folder']),
  path: z.string().min(1),
  memory: MemoryConfigSchema.optional(),
});

// MODIFICADO
export const ConfigSchema = z.object({
  version: z.literal(1),
  backend: BackendSchema,
  angels: z.array(AngelEntrySchema).min(1),
  sweep: SweepSchema,
  global_notes: z.string().optional(),
  memory: MemoryConfigSchema.optional().default({ target_pct: 25 }),
});
```

**Impacto**: Backward compatible — `memory` es opcional, default `{ target_pct: 25 }`.

### 5.2 `src/config/defaults.ts`

**Cambio**: Mantener default de target_pct a 25%.

```typescript
export const DEFAULT_BACKEND_CMD = ...;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_SWEEP_AUTONOMY = 'report-only' as const;
export const DEFAULT_MEMORY_TARGET_PCT = 25;
export const DEFAULT_MEMORY_MAX_TOKENS = undefined; // calculado de target_pct
```

### 5.3 `src/config/load.ts`

**Cambio**: Sin cambios mayores — el schema de Zod aplica defaults automáticamente.

### 5.4 `src/protocol/discovery.ts` → `src/protocol/discovery-enhanced.ts`

**Cambio**: Reemplazar (o extender) `buildDiscoveryContext` con una versión que:

1. Acepta `memoryConfig` como parámetro
2. Calcula budget dinámicamente
3. Clasifica archivos por valor
4. Lee profundamente archivos de alto valor
5. Aplica `filterBoilerplate`
6. Retorna contexto mucho más grande

Nueva firma:

```typescript
export interface DeepDiscoveryContext {
  fileListing: string;
  highValueFiles: Record<string, string>;  // completo + filtrado
  mediumValueFiles: Record<string, string>; // stub + filtrado
  lowValueFiles: string[];                  // solo nombres
  skippedFiles: string[];                   // razones de skip
  totalBytesRead: number;
  totalFilteredBytes: number;
  truncationNotice: string | null;
}

export function buildDeepDiscoveryContext(
  territoryPath: string,
  memoryConfig: MemoryConfig,
  options?: { depth?: number },
): DeepDiscoveryContext;
```

### 5.5 `src/angels/draft.ts` → `src/angels/template.ts`

**Cambio**: Reemplazar `generateBlankTemplate()` con una versión que genere las 11 secciones. Mantener `ingestWithBackend` y `createAngelDraft` pero actualizar el prompt builder de ingest con el nuevo template.

### 5.6 `src/protocol/prompt.ts`

**Cambio**: Modificar `PHASE_INSTRUCTIONS['discovery']` para que:
- Instruya escritura directa de angel.md (no PROPOSED PLAN)
- Mencione el budget de tokens disponible
- Indique que puede saltar boilerplate
- Mencione chunking como opción

Además, agregar nueva sección `[MEMORY CONFIG]` al prompt con el target size.

### 5.7 `src/protocol/response.ts`

**Cambio**: Agregar un nuevo campo opcional `angelMdWritten: boolean` al `ResponseData` para DISCOVERY phase, y validar que cuando `response === 'done'` en fase DISCOVERY, el archivo angel.md existe.

### 5.8 `src/angels/memory.ts`

**Cambio**: Agregar:
- `appendAngelMd()` para chunked writing
- `writeAngelMdChunked()` que maneja escritura en partes
- Extender `AngelFrontmatterSchema` con `memory_target_pct` y `memory_max_tokens` opcionales para per-angel override

### 5.9 `src/commands/onboard.ts`

**Cambio**: Flujo rediseñado:

```typescript
export async function onboardAngels(cwd: string, opts: OnboardOptions): Promise<void> {
  const config = ensureInit(cwd);
  const registry = AngelRegistry.fromConfig(config);
  const targets = selectAngels(registry, opts.angel);

  for (const angel of targets) {
    // ... existing checks ...
    
    const memoryConfig = angel.memory ?? config.memory ?? { target_pct: 25 };
    const ctx = buildDeepDiscoveryContext(absoluteAngelPath, memoryConfig);
    
    // Para angel.md grandes (>50KB estimados), usar chunked pipeline
    const estimatedSize = estimateAngelMdSize(ctx, memoryConfig);
    
    if (estimatedSize > CHUNK_THRESHOLD) {
      await onboardWithChunks(cwd, angel, ctx, memoryConfig, opts);
    } else {
      await onboardDirect(cwd, angel, ctx, memoryConfig, opts);
    }
  }
}

async function onboardDirect(...) {
  // Pipeline actual modificado para direct write
  const briefPath = writeBrief(cwd, {
    ...,
    task: 'Write your angel.md directly...',
  });
  const result = await invoke(cwd, { phase: 'discovery', ... });
  // Verificar que angel.md existe
  // Ajustar frontmatter
}

async function onboardWithChunks(...) {
  const chunkPlan = buildChunkPlan(calculatedBudget, files);
  for (const chunk of chunkPlan.sections) {
    // Invocar al angel con brief específico del chunk
    // El angel hace append a angel.md
  }
  // Verificación final
}
```

### 5.10 `src/protocol/orchestrate.ts`

**Cambio**: Modificar el prompt building para pasar `memoryConfig` al `buildPrompt`. Agregar variable de entorno `GUARD_ANGELS_VERIFY_RESPONSE` que opcionalmente verifica que el response file existe antes de parsear.

### 5.11 `src/config/schema.ts` (AngelFrontmatter extendido)

En `memory.ts`, extender `AngelFrontmatterSchema`:

```typescript
export const AngelFrontmatterSchema = z.object({
  status: z.enum(['draft', 'active']),
  last_updated: z.string().min(1),
  last_updated_by: z.enum(['main', 'sweep', 'self']),
  notes: z.string().optional(),
  memory_target_pct: z.number().min(1).max(100).optional(),
  memory_max_tokens: z.number().int().positive().optional(),
});
```

### 5.12 Nuevo: `src/protocol/discovery-filters.ts`

```typescript
export function filterBoilerplate(rawContent: string, fileExt: string): FileReadResult;
export function classifyFileValue(rawContent: string, fileExt: string): 'high' | 'medium' | 'low';
export function isStandardNodeImport(line: string): boolean;
export function isFrameworkBoilerplate(line: string, ext: string): boolean;
export function isTrivialJsDoc(line: string): boolean;
export function isFrameworkDecoration(line: string): boolean;
export function isConfigBoilerplate(line: string, ext: string): boolean;
```

### 5.13 Nuevo: `src/protocol/discovery-chunker.ts`

```typescript
export interface ChunkPlan { ... }
export function buildChunkPlan(targetTokens: number, files: string[], maxOutputTokens: number): ChunkPlan;
export function estimateAngelMdSize(ctx: DeepDiscoveryContext, memoryConfig: MemoryConfig): number;
```

---

## 6. Diagrama de Flujo: Antes vs Después

### Antes (Actual)

```
User: angels onboard src/auth
         │
         ▼
   buildDiscoveryContext()
    ├── fileListing (500 lines max)
    └── priorityFiles (50KB / 5KB / 10 files)
         │
         ▼
   writeBrief() → 50KB context
         │
         ▼
   invoke() → Backend genera response file
         │
         ▼
   parseResponse() → PROPOSED PLAN (body)
         │
         ▼
   writeAngelMd(body)
```

### Después (Propuesto)

```
User: angels onboard src/auth
         │
         ▼
   loadConfig() → memory: { target_pct: 25 }
         │
         ▼
   buildDeepDiscoveryContext()
    ├── fileListing (completo)
    ├── highValueFiles (80% budget, completo + filtrado)
    ├── mediumValueFiles (15% budget, stub + filtrado)
    └── lowValueFiles (5% budget, solo nombres)
         │
         ▼
   estimateAngelMdSize()
    │
    ├── < 50KB ──── onboardDirect()
    │                  │
    │                  ▼
    │            writeBrief(directWrite=true)
    │                  │
    │                  ▼
    │            invoke() → Backend escribe angel.md directamente
    │                  │
    │                  ▼
    │            verifyAngelMd() + updateFrontmatter()
    │
    └── >= 50KB ──── onboardWithChunks()
                       │
                       ▼
                 buildChunkPlan(5 chunks)
                       │
                       ▼
                 Chunk 1: Charter + Architecture
                    │ → appendAngelMd()
                    ▼
                 Chunk 2: Public Contract + Invariants
                    │ → appendAngelMd()
                    ▼
                 Chunk 3: Code Coverage (files 1-10)
                    │ → appendAngelMd()
                    ▼
                 Chunk 4: Code Coverage (files 11+) + Data Model
                    │ → appendAngelMd()
                    ▼
                 Chunk 5: Critical Flows + Testing + Decision Log + Debt
                    │ → appendAngelMd()
                    ▼
                 finalizeAngelMd()
```

---

## 7. Estimación de Impacto

| Aspecto | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Max context size DISCOVERY | 50 KB | Configurable (default ~1MB) | ~20x |
| Template sections | 6 | 11 | +83% |
| Per-file reading depth | 200 lines / 5KB | Archivo completo (high value) | Ilimitado |
| Filtrado de boilerplate | No | Sí | ~30-50% más contenido útil por KB |
| Escritura angel.md | vía PROPOSED PLAN | Directa o chunked | Sin límite práctico |
| Configurable target | No | Sí (target_pct o max_tokens) | N/A |
| Chunking para respuestas grandes | No | Sí (N invocaciones) | Escalable |
| Backward compatible | — | Sí (defaults a comportamiento actual) | Sin breaking changes |

### Tokens Típicos por Sección (estimación para angel.md de 250K tokens)

| Sección | % del total | Tokens aprox |
|---------|------------|-------------|
| Charter y Boundaries | 3% | 7,500 |
| Arquitectura del Área | 5% | 12,500 |
| Public Contract | 8% | 20,000 |
| Invariantes y Reglas | 4% | 10,000 |
| Code Coverage (20 archivos × 4K tokens c/u) | 32% | 80,000 |
| Data Model | 10% | 25,000 |
| Critical Flows | 12% | 30,000 |
| Testing Patterns | 8% | 20,000 |
| Decision Log | 8% | 20,000 |
| Known Debt y TODO | 5% | 12,500 |
| Dependencias | 5% | 12,500 |

---

## 8. Risks y Mitigaciones

| Risk | Impacto | Mitigación |
|------|---------|------------|
| **Backend timeout** al generar 250K tokens | Alto — invocación falla | Chunking reduce cada invocación a ~50K tokens. Timeout configurable por chunk. |
| **Costo de API** aumenta (más tokens por invocación) | Medio | El target_pct es configurable por proyecto (default 25%). El usuario puede bajarlo. |
| **Calidad disminuye** con prompts muy largos | Medio | El boilerplate filtering asegura que los tokens se usen en contenido valioso. El chunking evita prompts excesivamente largos. |
| **Respuesta truncada** por backend limit | Alto — el backend corta el output | Direct write evita el límite de output del response file. chunking si el backend tiene límite de tokens de salida. |
| **angel.md corrupto** si el proceso muere a mitad de chunk | Medio | `appendAngelMd()` usa escritura atómica + backup del estado previo. En chunking, se puede retomar desde el último chunk exitoso. |
| **Overengineering** para proyectos pequeños | Bajo | Si `target_pct <= 5` (angel.md pequeños), el pipeline cae a comportamiento actual (simple, sin chunking). |
| **Backend no soporta escritura de archivos** (ej: API-only) | Alto | Si el backend no puede escribir archivos, se usa el modo legacy (PROPOSED PLAN). Config `backend.can_write_files: boolean`. |

---

## 9. Roadmap de Implementación

### Fase 1: Foundation (Día 1-2)
- [x] 5.1: Schema changes (`schema.ts`, `defaults.ts`)
- [x] 5.11: Frontmatter extension (`memory.ts`)
- [x] 5.5: New template (`template.ts`)
- [x] 5.12: Boilerplate filters (`discovery-filters.ts`)

### Fase 2: Deep Discovery (Día 3-4)
- [x] 5.4: Enhanced discovery (`discovery-enhanced.ts`)
- [x] 5.6: Prompt changes (`prompt.ts`)
- [ ] Pruebas con proyectos reales de diferentes tamaños
- [ ] Ajuste de umbrales de filtrado

### Fase 3: Direct Write (Día 5-6)
- [x] 5.9: onboard.ts refactor (direct write path)
- [x] 5.7: Response parser extension
- [x] 5.10: Orchestrate.ts adjustments
- [x] Pruebas de escritura directa con backends Claude y Codex

### Fase 4: Chunking (Día 7-8)
- [x] 5.13: Chunk planner (`discovery-chunker.ts`)
- [x] 5.8: AppendAngelMd (`memory.ts`)
- [x] 5.9: onboard.ts chunked path
- [x] Pruebas de chunking con angel.md de 250K tokens

### Fase 5: Polish (Día 9-10)
- [x] Documentación actualizada (`docs/architecture.md`, README.md, CHANGELOG.md)
- [x] Tests de integración para pipeline completo
- [x] Benchmark: comparar calidad de angel.md antes vs después
- [x] CLI flags: `--target-pct <n>`, `--max-tokens <n>`

---

## Apéndice A: Ejemplo de `_config.yml` con el nuevo schema

```yaml
version: 1
backend:
  angel_cmd: claude -p --dangerously-skip-permissions
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: .
  - id: src-api
    type: folder
    path: src/api
    memory:
      max_tokens: 200000  # override per-angel
  - id: src-db
    type: folder
    path: src/db
    # usa el default global (25%)
sweep:
  autonomy: report-only
memory:
  target_pct: 25
  # max_tokens: 250000  # override global (tiene prioridad sobre target_pct)
global_notes: |
  This project uses Express.js with TypeScript.
  Prefer functional components over classes.
```

## Apéndice B: Ejemplo de `angel.md` generado (fragmento de ~2K tokens)

```markdown
---
status: draft
last_updated: 2026-06-03T12:00:00.000Z
last_updated_by: main
memory_target_pct: 25
---

# Angel: src/api (folder)

## Charter y Boundaries

**Owns:**
- Definición y registro de rutas HTTP (/api/*)
- Validación de request/response schemas con Zod
- Manejo de errores HTTP (4xx, 5xx) con formato estandarizado
- Versionado de API (v1, v2)

**Does NOT own:**
- Lógica de negocio → `src/services/`
- Persistencia → `src/db/`
- Autenticación JWT → `src/auth/`

## Arquitectura

src/api/
├── routes/           # Route definitions (express.Router)
│   ├── auth.ts       # POST /login, POST /register
│   └── users.ts      # GET/PUT /users/:id
├── middleware/
│   ├── validate.ts   # Zod schema validation middleware
│   └── error.ts      # Global error handler
├── schemas/
│   └── v1/           # Zod schemas per endpoint
├── index.ts          # Router aggregation + export

## Code Coverage

### src/api/routes/auth.ts
**Propósito**: Define rutas de autenticación (login/register/refresh).
**Lógica**: Cada handler delega a `src/services/auth.ts`. El middleware `validate()` se aplica por ruta. Edge cases: rate limiting por IP en login (3 intentos/15min), token refresh rotation.
**Deps internas**: validate.ts, auth.service.ts
**Deps externas**: express.Router, zod

### src/api/middleware/validate.ts
**Propósito**: Factory que retorna middleware Express de validación.
**Lógica**: Toma un schema Zod, valida req.body/req.query/req.params contra combinaciones configurables. Edge cases: arrays vacíos, strings opcionales vs nullable, transforms (coerce).
```

---

*Fin del documento de rediseño.*