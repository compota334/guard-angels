# Guard Angels — Auditoría de Performance y Escalabilidad

> **Estado a 2026-07-08 (v0.3.0): resuelto en su mayoría.** Los hallazgos críticos de esta auditoría ya fueron atendidos: rotación del newspaper con cursores por generación y lectura por offset real (Propuesta 2), archivado automático de briefs/responses/logs viejos por sweep y `doctor --archive` (Propuestas 1 y 4), pool de concurrencia para onboard y sweep (Propuesta 5), y journal determinístico que mantiene fresca la memoria sin invocaciones (relacionado a 1.3). Ver CHANGELOG 0.3.0. El documento se conserva como registro del análisis; no planificar trabajo a partir de él sin verificar contra el código actual.

**Fecha:** 2026-05-12
**Alcance:** Análisis estático del código fuente (`src/`). No se ejecutaron benchmarks ni pruebas de carga.
**Conclusión general:** El sistema funciona correctamente para uso liviano (~10 ángeles, semanas de operación), pero acumula estado sin límite en 5 vectores independientes. Bajo uso sostenido (6+ meses, trabajo diario), ocurrirán fallas en cascada empezando por el sistema de briefs, seguido por la memoria de los ángeles y los inboxes de cables. La mayoría de los problemas tienen solución arquitectónica sin reescritura mayor.

---

## 1. Hallazgos por Subsistema

### 1.1 Sistema de Briefs (`_briefs/`)

**Archivos analizados:** `src/commands/brief.ts`, `src/protocol/brief.ts`, `src/protocol/parser-utils.ts`

| Hallazgo | Ubicación | Severidad | Descripción |
|----------|-----------|-----------|-------------|
| Overflow de secuencia a 999 | `parser-utils.ts:111,120` | **CRÍTICO** | La regex `(\d{3})` solo captura secuencias de exactamente 3 dígitos. La secuencia 1000 es invisible al escáner, por lo que `computeNextSeq` devuelve `"1000"` repetidamente y `writeFileSync` sobrescribe el mismo archivo en silencio. A partir del brief #1000 en un mismo día para un mismo ángel, todos los briefs subsiguientes se pierden. |
| Sin limpieza de briefs | `brief.ts:38-48` | **CRÍTICO** | `_briefs/<angel-id>/` crece para siempre. No existe ningún mecanismo de borrado, rotación o archivado en el código de escritura. `doctor --archive` archiva briefs pero solo bajo demanda explícita del operador. |
| Escaneo O(n) en cada escritura | `parser-utils.ts:104-118` | **ALTO** | `readdirSync(dir)` itera todos los archivos del directorio en cada `writeBrief`. Sin limpieza, este directorio acumula miles de archivos y cada nuevo brief paga el costo de enumerarlos todos. |
| TOCTOU sin lock de escritura | `brief.ts:41-47` | **MEDIO** | `computeNextSeq` + `writeFileSync` sin protección atómica. Con sweeps paralelos (commit `4e0565c`), dos invocaciones concurrentes pueden derivar el mismo nombre de archivo y la segunda sobrescribe a la primera. |
| Sin límite de tamaño de brief | `brief.ts:100`, `commands/brief.ts:33` | **BAJO** | `task: string` se acepta sin validación de longitud. Un brief multi-megabyte se escribe a disco y luego se parsea completo en memoria. |

**Riesgo de crecimiento descontrolado:** `_briefs/` está en `.gitignore`, así que no contamina el repo, pero llena el disco sin advertencia.

---

### 1.2 Newspaper (`_newspaper.md`) y Cursors

**Archivos analizados:** `src/messaging/newspaper.ts`, `src/commands/newspaper.ts`, `src/messaging/cursors.ts`

| Hallazgo | Ubicación | Severidad | Descripción |
|----------|-----------|-----------|-------------|
| Lectura completa del archivo en cada acceso | `newspaper.ts:97` | **CRÍTICO** | `readFileSync` carga el archivo entero en memoria, luego `subarray` descarta lo anterior al cursor. El cursor ahorra parsing pero **no ahorra I/O**. Con newspaper de 5MB, cada ángel en cada sweep lee 5MB de disco aunque solo haya 1 entrada nueva. |
| Sin rotación ni truncación | `newspaper.ts` (todo) | **CRÍTICO** | El archivo crece monotónicamente sin límite. No existe `maxSize`, rotación por fecha, ni mecanismo de archival. |
| `showNewspaper` ignora el cursor | `commands/newspaper.ts:32` | **ALTO** | Siempre lee desde byte 0 (`readNewspaperSince(cwd, 0)`), filtra por timestamp en memoria. Con 10K entradas, parsea todo y filtra post-hoc. Sin paginación ni `--limit`. |
| Filtro lexicográfico frágil | `commands/newspaper.ts:43` | **BAJO** | `entries.filter(e => e.timestamp >= sinceIso)` funciona solo con UTC. Timestamps con offset rompen el orden lexicográfico. |
| Cursor > EOF es silencioso | `newspaper.ts:113` | **BAJO** | Si el cursor apunta más allá del fin del archivo (tras una hipotética rotación), `subarray` devuelve buffer vacío y el ángel deja de recibir eventos sin error. |

El sistema de cursores por ángel es arquitectónicamente correcto: cada ángel tiene su propio offset en `_cursors/<angel-id>`, atómicamente escrito. El problema es que el beneficio se anula porque `readFileSync` ignora el offset para el I/O.

---

### 1.3 Memoria de los Ángeles (`angel.md`)

**Archivos analizados:** `src/angels/memory.ts`, `src/protocol/prompt.ts`, `src/protocol/orchestrate.ts`

| Hallazgo | Ubicación | Severidad | Descripción |
|----------|-----------|-----------|-------------|
| Sin límite de tamaño | `memory.ts` (todo) | **CRÍTICO** | `readAngelMd` lee el archivo completo. `writeAngelMd` escribe sin validación de longitud. Cada ronda de execute/sweep puede añadir secciones. Tras 50+ rondas, un `angel.md` puede alcanzar decenas de miles de tokens sin advertencia. |
| `angel.md` completo en cada prompt | `orchestrate.ts:94`, `prompt.ts` | **CRÍTICO** | El campo `raw` del angel.md se inyecta completo como `[YOUR MEMORY]` en cada prompt, para cada fase (incluyendo sweep). Sin resumen, sin ventanas, sin truncación. |
| Sin diagnóstico de "prompt too large" | `orchestrate.ts:169` | **ALTO** | Si el prompt acumulado excede el context window del modelo, el backend falla con un `spawn_error` genérico. El operador no recibe indicación de que la causa fue el tamaño del prompt. |
| `getProtocolHeaderLength()` no se usa | `prompt.ts:234-236` | **BAJO** | Existe una función helper para calcular el tamaño del protocolo, pero nunca se invoca desde el pipeline. Es código muerto. |

**Trayectoria de crecimiento del prompt** (8 secciones, ninguna truncada):

| Sección | Fuente | Vector de crecimiento |
|---------|--------|-----------------------|
| `[PROTOCOL]` | Fija | Constante (~125 tokens) |
| Phase instructions | Fija por fase | Constante (~75-100 tokens) |
| `[ANGEL IDENTITY]` | `folderListing` | Lineal con número de archivos en el folder |
| **`[YOUR MEMORY]`** | **`angel.md` completo** | **Crece cada ciclo** |
| **`[NEWSPAPER DELTA]`** | **`newspaperDelta`** | **Depende del caller** |
| `[INBOX]` | Cables en inbox | Los urgentes entran completos; normales solo asunto |
| `[BRIEF]` | Brief file | Acotado por el archivo |
| `[OUTPUT INSTRUCTIONS]` | Fija | Constante (~200 tokens) |

Claude Sonnet tiene 200K tokens de ventana, pero la calidad de comprensión se degrada mucho antes del límite duro. El par `[YOUR MEMORY]` + `[NEWSPAPER DELTA]` es el que empujará el prompt más allá de la zona de comfort primero.

---

### 1.4 Contexto Acumulado en Cada Invocación

**Archivo analizado:** `src/protocol/prompt.ts`, `src/protocol/orchestrate.ts`

Cada invocación de ángel recibe **todo** lo siguiente sin truncación:

1. **Protocolo** — fijo, justificado
2. **Instrucciones de fase** — fijo, justificado
3. **Folder listing** — `readdirSync` de un solo nivel. Justificado para que el ángel conozca su territorio. No crece desproporcionadamente.
4. **Angel memory completo** — **riesgo alto**. Un `angel.md` de 15KB es manejable; uno de 80KB no.
5. **Newspaper delta** — **riesgo alto**. Depende de cuánto tiempo pasó desde la última lectura del ángel. Si el cursor se actualiza correctamente, debería ser pequeño, pero el sweep actual puede saltar entradas (ver §1.5).
6. **Inbox** — **riesgo medio**. Cables urgentes se inlinean completos; los normales solo llevan asunto. Diseño correcto, pero los inboxes nunca se vacían (ver §1.7).
7. **Brief** — justificado, es la tarea a ejecutar.
8. **Output instructions** — fijo, justificado.

**Qué se podría truncar/resumir:**
- `[YOUR MEMORY]` para sweeps: solo se necesita la sección de invariantes y charter, no el historial completo de cambios.
- `[NEWSPAPER DELTA]`: imponer un límite de caracteres a nivel de orquestador.
- `[ANGEL IDENTITY]`: el folder listing podría truncarse a N archivos en proyectos muy grandes.

---

### 1.5 Velocidad y Cuellos de Botella

**Archivos analizados:** `src/backend/claude.ts`, `src/backend/factory.ts`, `src/locks/lock.ts`, `src/commands/sweep.ts`

| Cuello de botella | Ubicación | Impacto | Descripción |
|-------------------|-----------|---------|-------------|
| Lock mantenido durante toda la invocación | `orchestrate.ts:81-262` | **ALTO** | El lock por ángel se adquiere antes de spawnear Claude Code y se libera en `finally`. Con timeout de 600s, un ángel bloquea su lock por hasta 630s. |
| Sweep: head-of-line blocking | `sweep.ts:46,67-69` | **MEDIO** | `Promise.allSettled` en batches fijos de 5. Si el ángel #3 tarda 60s y los otros 4 terminan en 2s, el batch entero espera 58s. Con 100 ángeles y 10% de timeouts, ~10 batches se estancan. |
| Discovery: doble `readdirSync` completo | `discovery.ts:52,75` | **MEDIO** | En un repo de 50K archivos, Node construye el array completo dos veces antes de filtrar. Los directorios de scaffold (`node_modules`) se filtran post-hoc. |
| Identificación: sin ranking de candidatos | `identify.ts:144` | **MEDIO** | `MAX_RESULTS=200` trunca sin priorizar por profundidad o relevancia. En monorepos, los primeros 200 (orden de filesystem) pueden no ser los más importantes. |
| Prompt como argumento CLI (ClaudeAdapter) | `claude.ts:18` | **MEDIO** | Prompt pasado como último argumento posicional. En prompts grandes (>1.5MB) se alcanza `ARG_MAX` (E2BIG) y el spawn falla. Los otros adaptadores usan stdin. |
| Cursor puede saltar entradas | `sweep.ts:88,135` | **MEDIO** | El cursor se lee al inicio del sweep y se actualiza al final. Entradas agregadas por sweeps concurrentes entre inicio y fin son permanentemente salteadas para ese ángel. |

**El mayor cuello de botella es el spawn de Claude Code en sí mismo**, que es inherente al diseño (cada ángel es un proceso fresco). Esto no es un defecto sino una característica. Las optimizaciones deben enfocarse en reducir el trabajo desperdiciado alrededor del spawn.

---

### 1.6 Límites de Archivos y Constantes

**Archivos analizados:** `src/protocol/discovery.ts`, `src/angels/identify.ts`, `src/angels/ingest.ts`

| Constante | Valor | Ubicación | Evaluación |
|-----------|-------|-----------|------------|
| `MAX_PRIORITY_CHARS` | 51,200 | `discovery.ts` | Razonable para contexto de LLM. No limita el trabajo de enumeración. |
| `MAX_FILE_SNIPPET_CHARS` | 5,120 | `discovery.ts` | Razonable. Suficiente para que el ángel vea la estructura de un archivo. |
| Max priority files | 10 | `discovery.ts` | Razonable. 10 fragmentos de 5KB = 50KB total. |
| `maxLines` (listing) | 500 | `discovery.ts` | Razonable para output. No limita el `readdirSync` subyacente. |
| `MAX_RESULTS` | 200 | `identify.ts:14` | **Insuficiente para monorepos grandes.** 200 carpetas sin ranking por relevancia. Una heurística más estricta o un ranking por profundidad/importancia mejoraría la selección. |
| `MAX_DEPTH` | 10 | `identify.ts:13` | Generoso. En árboles balanceados puede alcanzar millones de inodos. |
| Ingest seed cap | 100KB | `ingest.ts:56` | Razonable. La truncación es silenciosa (sin flag estructurado), pero el límite es adecuado. |

**Qué pasa en proyectos muy grandes (>50K archivos):**
- `discovery.ts` construye dos arrays de 50K entradas en memoria. Latencia de varios segundos.
- `identify.ts` puede recorrer cientos de miles de directorios (aunque secuencialmente, es lento).
- La heurística de un solo signal (`identify.ts:220`) sobre-selecciona carpetas con nombres no genéricos pero sin código, consumiendo slots del límite de 200.

---

### 1.7 Longevidad: ¿Qué se rompe primero en 6 meses de uso diario?

**Archivos analizados:** `src/commands/doctor.ts`, `src/messaging/cables.ts`, `src/locks/lock.ts`

#### Cronología de fallas esperadas (estimada)

| Orden | Subsistema | Trigger | Síntoma |
|-------|-----------|---------|---------|
| **1º** | **Briefs — overflow de secuencia** | >999 briefs en un día para un mismo ángel | Sobrescritura silenciosa de briefs. Datos perdidos sin error. |
| **2º** | **Inboxes — acumulación sin limpieza** | Semanas de cables entre ángeles | Cada sweep re-procesa todo el historial de cables. Prompt crece linealmente. |
| **3º** | **Angel memory — crecimiento sin límite** | 50+ rondas de execute/sweep | `angel.md` alcanza tamaño que degrada la calidad del LLM o excede el context window. Fallos como "spawn_error" sin diagnóstico. |
| **4º** | **Newspaper — sin rotación** | Meses de eventos | `readFileSync` del archivo completo en cada sweep se vuelve lento. 5MB+ de lectura por ángel. |
| **5º** | **Locks huérfanos por crash** | SIGKILL/OOM kill | Lock persiste hasta TTL expiry (~10 min). Todos los ángoles bloqueados. |

#### Doctor --archive: qué cubre y qué no

| Directorio | ¿Archivado por `--archive`? | ¿Tiene algún mecanismo de limpieza? |
|-----------|------------------------------|-------------------------------------|
| `_briefs/` | ✅ Sí | Solo bajo demanda explícita |
| `_responses/` | ✅ Sí | Solo bajo demanda explícita |
| `_logs/` | ✅ Sí | Solo bajo demanda explícita |
| `_inbox/` | ❌ **No** | **Ninguno** — los cables nunca se borran |
| `_outbox/` | ❌ No | Ninguno |
| `_newspaper.md` | ❌ No | Ninguno |
| `_cursors/` | ❌ No | No necesita (archivos de 1 entero) |
| `_locks/` | ❌ No | Stale locks se detectan y reclaman |
| `angel.md` | ❌ No (protegido explícitamente) | No debería (es memoria persistente) |

**Problema más grave de longevidad:** Los inboxes de cables (`_inbox/<angel-id>/`) son el único subsistema sin absolutamente ningún mecanismo de limpieza — ni automático, ni bajo demanda, ni vía `doctor --archive`. Cada cable enviado permanece para siempre en el inbox del destinatario. En un sistema con 10 ángeles activos que se envían cables entre sí, esto produce crecimiento O(N²) en el número total de archivos de cable.

**Problema de colisión en cables:** `buildCableFilename` (`cables.ts:270-276`) usa timestamp con precisión de segundo + slug del remitente. Dos cables del mismo ángel en el mismo segundo producen el mismo nombre de archivo → el segundo sobrescribe al primero silenciosamente.

---

## 2. Riesgos Priorizados

### Críticos (requieren atención inmediata)

| # | Riesgo | Impacto | Probabilidad con uso diario |
|---|--------|---------|-----------------------------|
| R1 | Overflow de secuencia de briefs (999/día/ángel) | **Pérdida de datos silenciosa** | Baja en uso manual, **alta en automatización** |
| R2 | Inboxes de cables sin limpieza | **Crecimiento O(N²), prompts inmanejables** | **Alta** — cada cable es permanente |
| R3 | Angel memory sin límite de tamaño | **Degradación de calidad del ángel, fallos de context window** | **Alta** — cada execute/sweep añade contenido |
| R4 | Newspaper sin rotación | **Lectura completa del archivo en cada sweep, I/O lineal creciente** | **Media** — meses de operación para ser notable |

### Altos (deben atenderse en el próximo ciclo)

| # | Riesgo | Impacto |
|---|--------|---------|
| R5 | `readFileSync` del newspaper ignora el cursor para I/O | Desperdicio de I/O y memoria en cada lectura |
| R6 | Sin diagnóstico de "prompt too large" | Fallos opacos, difícil diagnosticar la causa |
| R7 | Locks huérfanos por SIGKILL/OOM | Bloqueo de todos los ángeles por ~10 min |
| R8 | Sweep con head-of-line blocking | 100 ángeles con 10% timeout → múltiples batches estancados |

### Medios (mejoras de calidad)

| # | Riesgo |
|---|--------|
| R9 | Doble `readdirSync` completo en discovery (50K+ archivos) |
| R10 | Prompt como argumento CLI en ClaudeAdapter (riesgo ARG_MAX) |
| R11 | Cursor salta entradas en sweeps concurrentes |
| R12 | `MAX_RESULTS=200` sin ranking en identify (monorepos) |
| R13 | Colisión de nombres de cable en mismo segundo |
| R14 | `getProtocolHeaderLength()` es código muerto |

---

## 3. Propuestas de Mejora (Priorizadas por Impacto)

### Propuesta 1: Sistema de retención de briefs
**Impacto:** Resuelve R1, parcialmente R2
**Esfuerzo:** Bajo

- Cambiar `computeNextSeq` para usar `(\d+)` en vez de `(\d{3})` y `padStart(4, '0')` para soportar hasta 9999 briefs/día.
- Agregar limpieza automática: al escribir un brief, borrar briefs de más de N días en el mismo directorio. N configurable, default 30.
- Agregar lock atómico en `writeBrief` (usar `writeFileSync` con flag `wx` y reintentar con seq incrementado en caso de `EEXIST`).

### Propuesta 2: Lectura del newspaper por offset real
**Impacto:** Resuelve R4, R5
**Esfuerzo:** Bajo

- Reemplazar `readFileSync(npFile)` + `subarray(cursor)` por `fs.openSync` + `fs.readSync(fd, buffer, 0, length, cursor)`.
- Esto reduce la lectura de O(tamaño_total) a O(delta_desde_cursor) tanto en I/O como en memoria.
- Agregar rotación: si `newspaper.md` supera N bytes (default 1MB), renombrar a `_newspaper-YYYY-MM.md` y empezar archivo nuevo. Los cursores deben trackear (archivo, offset) en vez de solo offset.

### Propuesta 3: Resumen de angel.md para sweeps
**Impacto:** Resuelve R3, R6
**Esfuerzo:** Medio

- Para fase SWEEP: en vez de pasar el `angel.md` completo, extraer solo las secciones de `Charter`, `Invariants`, `Public contract` y `Open questions`. Omitir el historial de cambios.
- Para fases BRIEF/EXECUTE: pasar el `angel.md` completo (el ángel necesita contexto completo para decidir).
- Agregar un límite configurable de tamaño máximo de `angel.md` (`maxAngelMdBytes`, default 32KB). Si se excede, advertir y sugerir `doctor --compact`.
- Agregar diagnóstico específico: si `buildPrompt` produce un prompt > N tokens, loguear advertencia con el tamaño exacto de cada sección.

### Propuesta 4: Limpieza automática de inboxes
**Impacto:** Resuelve R2
**Esfuerzo:** Bajo

- Después de que un ángel procesa sus cables (en execute o sweep), mover los archivos procesados a `_inbox/<angel-id>/_processed/` o eliminarlos.
- Agregar `doctor --archive` para que también archive `_inbox/` y `_outbox/`.
- Agregar timestamp de procesamiento al cable para auditoría.

### Propuesta 5: Pool de workers para sweep
**Impacto:** Resuelve R8
**Esfuerzo:** Medio

- Reemplazar `Promise.allSettled` en batches fijos por un semáforo/worker pool: mantener N workers activos, lanzar nuevo trabajo apenas uno termina.
- Mantener `SWEEP_CONCURRENCY` configurable vía `_config.yml` y variable de entorno.

### Propuesta 6: Robustez de locks
**Impacto:** Resuelve R7
**Esfuerzo:** Bajo

- Agregar handlers de `process.on('exit')`, `SIGTERM`, `SIGINT` que invoquen `releaseLock()`.
- NOTA: `SIGKILL` y OOM kill no pueden manejarse. Para esos casos, el TTL es la única defensa. Reducir el TTL default de `timeout + 30s` a `timeout + 10s` reduciría la ventana de bloqueo.

### Propuesta 7: ClaudeAdapter por stdin
**Impacto:** Resuelve R10
**Esfuerzo:** Bajo

- Cambiar `ClaudeAdapter.invoke` para usar `input: opts.prompt` (stdin) en vez de argumento posicional. Esto requiere también cambiar la invocación de `claude -p` para que lea la tarea de stdin. 
- **Precaución:** `claude -p` sin argumento CLI sale inmediatamente (pitfall #22 documentado en la skill). La sintaxis correcta sería `echo "$prompt" | claude -p 'execute the task described in stdin' --dangerously-skip-permissions`. Requiere prueba.

### Propuesta 8: Ranking en identify
**Impacto:** Resuelve R12
**Esfuerzo:** Bajo

- En vez de aceptar carpetas con 1 de 3 signals, requerir al menos 2 de 3.
- Ordenar resultados por profundidad (más superficial primero) + cantidad de archivos fuente.
- Si se excede `MAX_RESULTS`, loguear cuántas carpetas fueron omitidas y por qué.

### Propuesta 9: Diagnóstico de prompt size
**Impacto:** Resuelve R6
**Esfuerzo:** Bajo

- Después de `buildPrompt`, calcular `Buffer.byteLength(prompt, 'utf-8')`.
- Si supera un umbral configurable (default 100KB), loguear advertencia con breakdown por sección.
- Si la invocación falla con `spawn_error`, sugerir en el mensaje de error que el prompt podría ser demasiado grande.

---

## 4. Notas Técnicas

### 4.1 El sistema de locks es sólido en su núcleo

`acquireLock` usa `fs.writeFileSync` con flag `wx` (O_EXCL|O_CREAT), que es atómico en todos los filesystems POSIX. El path de recuperación de locks stale (check-then-remove) tiene un TOCTOU teórico pero la ventana es de microsegundos y el retry loop lo mitiga. El verdadero riesgo no es la corrección del lock sino la falta de cleanup en crashes.

### 4.2 El diseño de cursores es correcto pero inefectivo

La arquitectura de cursores por ángel (offset independiente, escritura atómica vía tmp+rename) es sólida. El problema es que `readFileSync` ignora el offset para el I/O, anulando el beneficio principal. Con la Propuesta 2, el sistema de cursores pasaría de ser decorativo a funcional.

### 4.3 El diseño append-only es intencional pero incompleto

Newspaper, briefs, responses e inboxes son append-only por diseño — una decisión arquitectónica válida para auditoría. El problema no es el diseño append-only sino la ausencia de una estrategia de retención: rotación por tamaño, archivado por antigüedad, o limpieza post-procesamiento. La infraestructura de archivado existe (`doctor --archive`) pero solo cubre 3 de 7 directorios acumulativos.

### 4.4 La paralelización del sweep (commit `4e0565c`) introdujo riesgos sutiles

La paralelización es correcta en su manejo de locks (un lock por ángel), pero expuso dos problemas:
1. TOCTOU en `writeBrief` (dos sweeps pueden briefear al mismo ángel concurrentemente)
2. Cursores que saltan entradas (un sweep lee el cursor, otro escribe al newspaper, el primero avanza el cursor más allá de lo que leyó)

---

## 5. Recomendación de Prioridad

Si solo se puede hacer una cosa: **Propuesta 1 + Propuesta 4** (arreglar overflow de briefs + limpiar inboxes). Estos son los dos vectores de crecimiento que producirán fallas visibles primero.

Si se puede hacer una iteración completa: **Propuestas 1-6** (briefs, newspaper I/O, angel memory resumen, inbox cleanup, worker pool, lock robustness). Esto cubre todos los riesgos críticos y altos.

Las propuestas 7-9 son mejoras de calidad que pueden esperar.

---

*Reporte generado por análisis estático del código fuente. No se realizaron pruebas de carga ni benchmarks. Los umbrales de falla son estimaciones basadas en el comportamiento asintótico de las estructuras de datos identificadas.*
