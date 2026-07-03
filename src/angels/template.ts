/**
 * Dense 11-section template for angel.md files.
 *
 * This file is the spiritual successor to draft.ts but maintains full
 * backward compatibility — draft.ts is NOT deleted and still works as before.
 * New code should prefer this template for dense memory generation.
 */

// ─── Template ───────────────────────────────────────────────────────────────

/**
 * Generate the complete 11-section template for an angel.md body.
 *
 * @param pathName - Path identifier for the angel (e.g. "src/auth" or "." for root)
 * @param typeName - Angel type ("root" or "folder")
 * @returns Complete markdown template body (without YAML frontmatter)
 */
export function getDenseTemplate(pathName: string, typeName: string = 'folder'): string {
  const pathDesc = pathName === '.' ? '. (project root)' : pathName;

  return `# Angel: ${pathDesc} (${typeName})

## Charter y Boundaries

<!--
Define qué posee este angel y qué NO posee.
- **Owns**: responsabilidades explícitas. Archivos/directorios que son de su competencia.
- **Does NOT own**: exclusiones claras, con referencias a qué angel lo posee.
- **Scope boundaries**: archivos en el territorio que NO son responsabilidad del angel.
SALTAR: contexto histórico, justificaciones, descripciones genéricas.
-->

- **Owns**:
  -
- **Does NOT own**:
  -
- **Scope boundaries**:
  -

---

## Arquitectura del Área

<!--
Diagrama ASCII de componentes y flujo de datos.
- Incluir un diagrama textual de la arquitectura (módulos, conexiones, data flow).
- Mencionar el patrón arquitectónico (MVC, layered, hexagonal, etc.).
- Describir cómo circula la información entre módulos.
SALTAR: descripciones de patrones obvios, imports, boilerplate.
-->

\`\`\`
┌──────────┐     ┌──────────┐
│          │────▶│          │
└──────────┘     └──────────┘
     │                 │
     ▼                 ▼
┌──────────┐     ┌──────────┐
│          │     │          │
└──────────┘     └──────────┘
\`\`\`

- **Patrón arquitectónico**:
- **Flujo de datos**:

---

## Public Contract

<!--
API surface que este angel expone al resto del codebase.
- **Exports**: funciones, clases, constantes exportadas con firmas.
- **API surface**: endpoints HTTP, handlers, métodos públicos.
- **Tipos públicos**: interfaces, types, enums exportados.
- **Eventos emitidos**: qué eventos/notificaciones produce.
- **Configuración aceptada**: env vars, flags, settings.
SALTAR: exports estándar de framework, re-exports obvios.
-->

- **Exports**:
  -
- **API surface**:
  -
- **Tipos públicos**:
  -
- **Eventos emitidos**:
  -
- **Configuración aceptada**:
  -

---

## Invariantes y Reglas de Negocio

<!--
Reglas que NUNCA deben violarse.
- **Invariantes**: validación estricta, condiciones que siempre deben cumplirse.
- **Business rules**: reglas de negocio que DEBEN cumplirse.
- **Precondiciones**: qué debe ser verdad antes de llamar a X.
- **Postcondiciones**: qué debe ser verdad después de llamar a X.
- **Reglas de consistencia**: relaciones entre datos que deben mantenerse.
SALTAR: reglas genéricas de TypeScript/JavaScript, obviedades.
-->

- **Invariantes**:
  -
- **Business rules**:
  -
- **Precondiciones**:
  -
- **Postcondiciones**:
  -
- **Reglas de consistencia**:
  -

---

## Cobertura de Código

<!--
Por CADA archivo del área (NO imports estándar, NO boilerplate).
### \`path/to/file.ts\`
- **Propósito**: una línea de qué hace.
- **Lógica interna**: descripción densa de la implementación.
- **Edge cases**: casos borde conocidos.
- **Dependencias internas**: qué funciones/módulos del área usa.
- **Dependencias externas**: qué librerías npm/pip/etc. usa (solo las relevantes).
- **Notas**: gotchas, optimizaciones, deuda técnica.
SALTAR: imports estándar, JSDoc vacío, decoradores de framework, boilerplate.
-->

### \`path/to/file.ts\`
- **Propósito**:
- **Lógica interna**:
- **Edge cases**:
- **Dependencias internas**:
- **Dependencias externas**:
- **Notas**:

### \`path/to/other.ts\`
- **Propósito**:
- **Lógica interna**:
- **Edge cases**:
- **Dependencias internas**:
- **Dependencias externas**:
- **Notas**:

---

## Data Model

<!--
Schemas, tipos, relaciones y state machines del área.
SALTAR: tipos estándar de librerías, relaciones triviales.
-->

### Schemas / Tipos

\`\`\`typescript
interface Example {
  id: string;
}
\`\`\`

### Relaciones

\`\`\`
Example 1──N Related
\`\`\`

### State Machines / Enums

\`\`\`
State: idle → processing → done
           ↘ error
\`\`\`

---

## Flujos Críticos

<!--
Secuencias de llamadas importantes y state machines.
SALTAR: flujos obvios (CRUD básico), flujos de framework.
-->

### Flujo: [Nombre del flujo]

1. \`firstStep()\` → description
2. \`secondStep()\` → description
3. \`thirdStep()\` → description

### State Machines

\`\`\`
Process: init → running → complete
             ↘ failed
\`\`\`

---

## Testing Patterns

<!--
Cómo se testea esta área.
SALTAR: config de testing estándar, setup de framework.
-->

- **Test runner**:
- **Fixtures**:
- **Mocks**:
- **Factories**:
- **Coverage goals**:
- **Test commands**: \`npm test\`

---

## Decision Log

<!--
Append-only. Cada entrada: Fecha, Decisión, Contexto, Alternativas Rechazadas, Consecuencias.
SALTAR: fechas sin decisión, entradas vacías.
-->

| Fecha | Decisión | Contexto | Alternativas Rechazadas | Consecuencias |
|-------|----------|----------|------------------------|---------------|
|       |          |          |                        |               |

---

## Known Debt y TODO

<!--
Deuda técnica y trabajo pendiente.
SALTAR: deuda obvia sin contexto, issues sin prioridad.
-->

- **Bugs conocidos**:
  -
- **Optimizaciones pendientes**:
  -
- **Refactors planeados**:
  -
- **Tech debt**:
  -

---

## Dependencies

<!--
Relaciones con otros angels.
SALTAR: dependencias de npm/pip (van en Code Coverage).
-->

- **Angels que necesito**:
  -
- **Angels que me necesitan**:
  -
`;
}