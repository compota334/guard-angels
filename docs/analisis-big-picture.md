# Análisis Big Picture — Guard Angel

> **Fecha:** 2026-07-03
> **Alcance:** Producto, mercado, arquitectura y visión. Basado en lectura completa de README, arquitectura, CHANGELOG, field reports #3/#4, auditoría de performance, historial git y relevamiento del mercado a julio 2026.
> **Tono:** crítico y directo, sin hype.

---

## 1. Core Concept & Goal

**La idea base:** cada carpeta significativa de un codebase tiene un agente LLM persistente ("angel") que es dueño del *porqué* de esa carpeta. El agente principal (Claude Code, Codex, etc.) no edita código directamente: delega vía un protocolo de dos fases (REVIEW → EXECUTE). Cada angel mantiene su memoria en `angel.md`, se comunica con otros angels vía cables, y todo queda registrado en un event log append-only (newspaper). Todo el estado vive en archivos dentro de `.angels/`, versionado en git. Sin base de datos, sin servicio, sin UI.

**El problema que ataca es real y está bien identificado:** los agentes de código pierden contexto entre sesiones, no tienen noción de ownership territorial, y las decisiones arquitectónicas ("por qué este módulo es así") se evaporan. Guard Angel convierte eso en tres primitivas: memoria persistente por territorio, un gate de revisión con derecho a veto (`proceed`/`concerns`/`refuse`), y un audit trail completo.

**Público objetivo implícito:** usuarios avanzados de CLIs de coding agents que trabajan en codebases medianos/grandes con loops autónomos (estilo Ralph). Hoy el público real es N=1: el autor. Esto no es un defecto per se — el producto está en fase de dogfooding intensivo y los field reports lo demuestran — pero condiciona todo lo que sigue.

**Lo que Guard Angel NO es (y está bien que no sea):** no es un framework de orquestación general (CrewAI, LangGraph), no es un swarm de agentes efímeros, no es una memoria vectorial. Es una capa de *gobernanza y memoria territorial* sobre CLIs existentes. Esa es su identidad más defendible y debería explicitarse más.

---

## 2. Estado actual vs ideal

### Lo que funciona (verificado, no aspiracional)

- **~9.5K LOC de TypeScript disciplinado**, 33 archivos de test, filosofía fail-loud consistente con lo que dice el README. El historial git muestra iteración seria: fixes de TOCTOU en locks, path traversal, parser YAML real, budgets de memoria.
- **Dogfooding real con resultados:** el field report #4 documenta ~30 horas de uso sobre un bot de trading en producción, 5 commits enviados, 7/8 angels ejercitados, cero rollbacks. Muy pocos proyectos hobby tienen esta calidad de feedback loop.
- **El pipeline de DISCOVERY rediseñado** (deep context, direct write, chunked writing) resolvió el cuello de botella de generación de `angel.md` documentado en el field report #3.
- **Backend-agnostic de verdad:** adapters para Claude Code, Codex, Droid y genérico vía stdin. Es una decisión estratégica correcta — no casarse con un vendor.
- **El gate draft→active** (la memoria generada por IA nunca se confía automáticamente) es un detalle de diseño maduro que casi nadie en el mercado tiene.

### La brecha con el ideal

1. **El lock global contradice la premisa del producto.** La arquitectura dice "only one angel can be invoked at a time" (`.angels/_locks/orchestrator.lock`). Un sistema cuyo pitch es "múltiples agentes con territorios independientes" que ejecuta estrictamente en serie es un multi-agente de nombre. Onboardear 8 angels es 8 invocaciones secuenciales de minutos cada una; un sweep de 10 angels es inaceptablemente lento. Los territorios disjuntos son *exactamente* la condición que permite paralelismo seguro — la primitiva para locks por territorio ya existe conceptualmente y no se usa.

2. **La memoria se genera bien pero se consume mal.** Chunked writing permite `angel.md` de 50KB+, y el default de `target_pct: 25` empuja a memorias grandes. Pero cada invocación inyecta el archivo completo en el prompt. No hay retrieval selectivo, ni índice, ni secciones cargadas por relevancia. El costo en tokens crece linealmente con la ambición de la memoria, y la auditoría de performance ya advierte que la memoria es el segundo vector de falla bajo uso sostenido. Se optimizó la escritura y se dejó la lectura sin resolver.

3. **Parsing frágil de respuestas en markdown plano.** Los field reports #3 y #4 documentan la misma clase de bug dos veces: el angel deja secciones vacías o escribe en paths inventados porque el contrato es texto libre con headers. Claude Code y Codex soportan salida estructurada (JSON schema, `--output-format`); seguir parseando markdown con regex es elegir fragilidad. Este es el tipo de bug que va a reaparecer con cada modelo nuevo.

4. **La ceremonia no siempre paga.** Brief + execute = 2 invocaciones LLM + intervención del agente principal para cada cambio, incluso trivial. El comando `ask` (agregado tras el field report #4) y `do` mitigan, pero el costo fijo del protocolo sigue siendo alto para cambios chicos. El riesgo de producto: el usuario racional bypasea el sistema para ediciones menores, la memoria queda stale, y el valor colapsa. Un sistema de gobernanza que depende de la disciplina del gobernado es frágil.

5. **Enforcement advisory.** Las escrituras fuera de territorio producen un WARNING y siguen (report #4, caso `.env.example`). Existe `--strict-territory` pero es opt-in. Para un producto cuyo argumento central es "los territorios importan", el default debería ser estricto.

6. **Deuda operacional conocida y sin resolver:** newspaper sin rotación con lectura O(archivo completo) en cada acceso, briefs que se acumulan sin límite, filtro de timestamps frágil. La auditoría de performance (2026-05-12) lo documenta con severidades; varios CRÍTICOS siguen abiertos.

7. **Cero distribución.** No publicado en npm, sin licencia, sin CI, instalación por `make install` desde el source. Coherente con "private by default", pero incompatible con cualquier ambición de mercado. Hay que decidir: herramienta personal o producto.

---

## 3. Comparativa con proyectos similares

El espacio se movió muy rápido en 2025-2026. Contexto honesto de dónde está parado Guard Angel:

| Proyecto | Qué hace | Solapamiento con Guard Angel |
|---|---|---|
| **Claude Code subagents / Agent Teams ("swarm mode")** | Subagentes nativos con roles, ejecución paralela, coordinación integrada | Alto en orquestación. Cero en memoria territorial persistente y audit trail |
| **CLAUDE.md anidados / AGENTS.md (estándar)** | Contexto por directorio leído automáticamente por el agente | Es el competidor silencioso de `angel.md` — hace 60% del valor con 5% de la ceremonia |
| **Claude-Flow / Ruflo v3.5** (ruvnet) | Meta-harness de swarms: memoria vectorial HNSW, neural routing, 87 tools MCP, RL | Máximo hype del nicho. Opuesto filosófico: complejidad maximalista vs. archivos en disco. GA gana en auditabilidad y simplicidad; pierde en features y comunidad |
| **Conductor** (Microsoft, open source, 2026) | Orquestación determinista de workflows multi-agente definidos en YAML | Valida la tesis "determinismo > autonomía mágica". No tiene memoria territorial |
| **Tutti** | CLI multi-agente con worktrees git aislados y artefactos tipados entre agentes | El aislamiento por worktree es la versión robusta de lo que `--strict-territory` intenta hacer con warnings |
| **Cognee / Memorix / mem0 / Letta** | Capas de memoria persistente (knowledge graphs, memoria cross-agent) para coding agents | Atacan la memoria con grafos AST y retrieval; GA usa markdown plano inyectado completo. La industria converge en "retrieval estructurado", no en "archivo grande en el prompt" |
| **Cline Memory Bank / Cursor rules** | Convenciones de archivos de contexto persistente por proyecto | Misma familia que `angel.md`, sin protocolo ni ownership |
| **CODEOWNERS (GitHub)** | Ownership territorial para humanos, review obligatorio por path | El ancestro conceptual directo. Nadie lo ha portado bien al mundo agéntico — esa es la oportunidad de GA |

**Lectura honesta del posicionamiento:** en orquestación pura, Guard Angel está por detrás del estado del arte (los subagentes nativos de Claude Code y los agent teams paralelos existen y son gratis). En memoria pura, los knowledge graphs de Cognee y similares son técnicamente superiores al markdown inyectado. **Donde Guard Angel no tiene competidor directo es en la intersección: ownership territorial + derecho a veto basado en invariantes + audit trail en git.** Ningún proyecto relevado tiene un agente que pueda *rechazar* un cambio porque viola las invariantes de su territorio, con el rechazo registrado y auditable. Eso es CODEOWNERS para agentes, y es un espacio vacío.

La trayectoria del mercado (memoria estructurada con retrieval, ejecución paralela, workflows deterministas, agentes de larga duración) confirma varias apuestas de GA (archivos + git, determinismo, fail-loud) y contradice dos decisiones (lock global, memoria monolítica inyectada).

---

## 4. Recomendaciones priorizadas

### Prioridad ALTA — sin esto el producto no escala ni se diferencia

1. **Reemplazar el lock global por locks por territorio + ejecución paralela.** `onboard`, `sweep` y briefs a angels disjuntos deben correr en paralelo. Es la mejora con mayor ratio impacto/esfuerzo: la estructura de territorios ya garantiza no-conflicto, y el costo actual en wall-clock es el principal dolor de uso real. Cables y newspaper necesitan escritura atómica concurrente (append con `O_APPEND` ya casi alcanza).

2. **Salida estructurada en vez de markdown parseado.** Donde el backend lo soporte (Claude Code `--output-format json`, Codex), exigir respuesta con schema (verdict, plan, cables, files_changed) y validar con Zod — que ya está en las dependencias. Mantener el parser de texto solo como fallback del adapter genérico. Mata de raíz la familia de bugs de los reports #3/#4.

3. **Hacer `--strict-territory` el default** (con opt-out explícito por brief). Complementar con enforcement en el origen: un hook de Claude Code (`PreToolUse` sobre Edit/Write) que bloquee ediciones del agente principal dentro de territorios con angel activo. Hoy la regla "manual edits are FORBIDDEN" vive en un párrafo de CLAUDE.md que el agente principal puede ignorar; un hook la vuelve mecánica.

4. **Cerrar los CRÍTICOS de la auditoría de performance:** rotación del newspaper + lectura desde offset real (el cursor existe pero no ahorra I/O), y limpieza/archivado automático de briefs. Es deuda conocida, documentada, y con solución diseñada. No cerrarla socava la promesa de "esto aguanta meses de uso diario".

### Prioridad MEDIA — diferenciación y eficiencia

5. **Retrieval selectivo de memoria.** Inyectar siempre Charter + Invariants (chicos, críticos) y cargar el resto de `angel.md` por relevancia al brief (por sección; los headers ya están estandarizados). Alternativa barata: un índice de secciones con resúmenes de una línea y que el angel pida secciones. Reduce el costo por invocación y desacopla "memoria rica" de "prompt caro".

6. **Cables activos, no pasivos.** Report #4: los cables son metadata que el operador tiene que relatar a mano. `--consume-cables` (ya agregado) va en la dirección correcta; falta que sea default en brief/execute y que `sweep` procese inboxes automáticamente. Un sistema de mensajería que requiere cartero humano no es un sistema de mensajería.

7. **Exponer angels como MCP server.** `angels_ask`, `angels_brief`, `angels_execute` como tools MCP convierte a GA en infraestructura consumible por cualquier agente (Claude Code, Codex, IDEs) sin depender de que el agente principal recuerde comandos de shell. Es además el canal de distribución natural en 2026.

8. **Métricas de valor, no solo de actividad.** Hoy no hay forma de responder "¿la memoria mejora los resultados?". Instrumentar: tasa de concerns/refuse útiles (que evitaron un bug real), frecuencia de briefs re-trabajados, staleness de angel.md vs. actividad git del territorio. Sin esto, el pitch del producto es anecdótico.

### Prioridad BAJA — apuestas de largo plazo

9. **Decidir la cuestión open source.** El nicho premia lo abierto (Ruflo, Conductor, Tutti son públicos); una herramienta de gobernanza cerrada y sin distribución no acumula ni usuarios ni confianza. Si se abre: npm publish, licencia, CI, y el README ya está a nivel. Si se mantiene privada: aceptar explícitamente que es una herramienta personal y optimizar para eso.

10. **Angel de PR review / modo CI.** `angels review --diff <range>`: cada angel afectado por un diff emite verdict sobre su territorio. Como GitHub Action sería la puerta de entrada de equipos (el reviewer territorial automático es un caso de uso que CODEOWNERS ya educó al mercado a querer).

11. **Sweep autónomo graduado.** El `autonomy: report-only` de v1 es correcto como default, pero el roadmap natural es permitir a angels de confianza hacer fixes de mantenimiento (docs stale, tests rotos por renames) bajo el mismo protocolo de audit.

### Qué NO hacer

- No agregar memoria vectorial/embeddings porque el mercado lo hace. La legibilidad de `angel.md` en git es el diferencial; un índice de secciones alcanza para el tamaño de memoria actual.
- No construir UI web ni servicio. "Archivos en disco, committeados en git" es la decisión arquitectónica más acertada del proyecto.
- No perseguir a Ruflo en features (neural routing, RL, 87 tools). Es otra categoría y otra filosofía; competir ahí es perder.

---

## 5. Oportunidades de mercado / roadmap sugerido

### La tesis de producto

El mercado 2026 tiene tres capas ya pobladas: orquestación (agent teams nativos, Conductor), memoria (Cognee, mem0, Memorix) y ejecución (los CLIs mismos). La capa vacía es **gobernanza**: quién puede tocar qué, con qué garantías, y con qué registro. A medida que los agentes corren más tiempo sin supervisión (la tendencia dominante del año), la pregunta "¿qué hizo el agente y quién lo autorizó?" pasa de nice-to-have a requisito. Guard Angel ya tiene las tres primitivas de esa capa: territorio, veto, audit trail.

**Pitch de una línea:** *CODEOWNERS para agentes de IA — cada módulo tiene un guardián con memoria, derecho a veto y registro auditable.*

Nichos concretos donde esa propuesta es más fuerte:

- **Loops autónomos largos** (Ralph-style, overnight runs): el operador no está mirando; el veto territorial y el newspaper son el mecanismo de control. GA ya documenta esta integración — es el caso de uso a profundizar primero.
- **Equipos con módulos sensibles** (auth, billing, infra): angels con invariantes estrictas como reviewer automático previo al humano.
- **Compliance/auditoría de cambios generados por IA:** el registro append-only de qué agente cambió qué y bajo qué brief es algo que ningún competidor relevado produce de forma nativa.

### Roadmap sugerido

**v0.2 — Robustez (4-6 semanas de esfuerzo equivalente):** salida estructurada + validación Zod; locks por territorio + paralelismo en onboard/sweep; strict-territory por default; rotación de newspaper y briefs. *Criterio de salida: 20 angels, un mes de uso diario, sin degradación ni bug de parsing.*

**v0.3 — Eficiencia de memoria:** retrieval selectivo por secciones; cables auto-consumidos; métricas de valor en `doctor`. *Criterio de salida: costo por brief reducido a la mitad con memoria igual o más rica.*

**v0.4 — Distribución:** decisión open source; npm publish + CI; MCP server; hook de enforcement para Claude Code. *Criterio de salida: un usuario externo onboardea un proyecto sin ayuda del autor.*

**v1.0 — Equipos:** `angels review` para PRs + GitHub Action; sweep con autonomía graduada; documentación de casos de uso de compliance.

### Riesgo existencial a monitorear

El riesgo principal no es un competidor: es que la plataforma absorba la categoría. Si Claude Code (o Codex) incorpora memoria territorial persistente con enforcement nativo — y los agent teams + CLAUDE.md anidados son dos tercios del camino — Guard Angel queda relegado a los backends que no lo tengan. Las defensas: (a) ser backend-agnostic en serio (ya lo es), (b) ser el estándar del *formato* de memoria territorial y del audit trail (por eso importa abrir el proyecto antes de que la ventana se cierre), y (c) profundizar donde la plataforma no va a ir: veto por invariantes, compliance, cross-backend.

---

## Referencias de mercado

- [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) — panorama de orquestadores
- [Ruflo (ex claude-flow)](https://github.com/ruvnet/ruflo) y [claude-flow v3](https://claude-flow.ruv.io/)
- [Conductor — Microsoft Open Source](https://opensource.microsoft.com/blog/2026/05/14/conductor-deterministic-orchestration-for-multi-agent-ai-workflows/)
- [Claude Code agent teams / swarm](https://www.atcyrus.com/stories/what-is-claude-code-swarm-feature) y [multi-agent sessions (docs)](https://platform.claude.com/docs/en/managed-agents/multi-agent)
- [Cognee — persistent codebase memory](https://www.cognee.ai/blog/guides/ai-coding-agent-persistent-codebase-memory)
- [The Code Agent Orchestra — Addy Osmani](https://addyosmani.com/blog/code-agent-orchestra/)
- [State of AI coding agents 2026](https://medium.com/@dave-patten/the-state-of-ai-coding-agents-2026-from-pair-programming-to-autonomous-ai-teams-b11f2b39232a)
- [Open-source agent orchestrators (Augment Code)](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
