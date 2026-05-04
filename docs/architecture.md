# Guard Angels Architecture

This document describes the internal structure and key design decisions of the Guard Angels CLI.

---

## Repository structure

```
src/
├── cli.ts                  # Entry point: registers all commands via commander
├── config/
│   ├── load.ts             # loadConfig(): reads and validates _config.yml
│   └── schema.ts           # Zod schemas for Config, AngelEntry
├── commands/
│   ├── init.ts             # angels init
│   ├── onboard.ts          # angels onboard
│   ├── activate.ts         # angels activate
│   ├── create.ts           # angels create
│   ├── list.ts             # angels list
│   ├── brief.ts            # angels brief
│   ├── execute.ts          # angels execute
│   ├── do.ts               # angels do (brief + execute)
│   ├── cable.ts            # angels cable / inbox
│   ├── newspaper.ts        # angels newspaper
│   ├── sweep.ts            # angels sweep
│   └── doctor.ts           # angels doctor
├── angels/
│   ├── identify.ts         # Heuristic folder candidate detection
│   ├── ingest.ts           # Read AGENTS.md / CLAUDE.md seed files
│   ├── memory.ts           # Read/write angel.md with frontmatter
│   └── registry.ts         # AngelRegistry: list, lookup by ID
├── protocol/
│   ├── orchestrate.ts      # invoke(): lock → prompt → spawn → log → parse
│   ├── prompt.ts           # buildPrompt(): assembles phase-specific prompt text
│   ├── discovery.ts        # buildDiscoveryContext(): recursive listing + priority files
│   ├── brief.ts            # writeBrief() / parseBrief()
│   ├── response.ts         # parseResponse(): extracts structured data from angel output
│   └── parser-utils.ts     # Shared date/seq helpers
├── backend/
│   ├── adapter.ts          # BackendAdapter interface
│   ├── factory.ts          # pickAdapter(): selects adapter from config
│   ├── claude.ts           # ClaudeAdapter
│   ├── codex.ts            # CodexAdapter
│   ├── droid.ts            # DroidAdapter
│   └── generic.ts          # GenericAdapter (stdin fallback)
├── locks/
│   └── lock.ts             # acquireLock() / releaseLock() — atomic file lock
├── logs/
│   └── log.ts              # createLogStreams() / writeLogMeta()
├── paths/
│   ├── layout.ts           # Path helpers for .angels/ subdirs
│   └── resolve.ts          # angelIdToPath() / pathToAngelId() — safe encoding
└── cable/
    └── cable.ts            # writeCable() / readInbox()
```

---

## .angels/ directory layout

```
.angels/
├── .gitignore              # Auto-created by init; excludes ephemeral dirs
├── _config.yml             # Project config: backend cmd, angel list, sweep settings
├── _newspaper.md           # Append-only event log (cable, brief, execute, sweep)
├── _briefs/                # IGNORED: outgoing briefs (main → angels)
│   └── <angel-id>/
├── _responses/             # IGNORED: angel responses
│   └── <angel-id>/
├── _inbox/                 # IGNORED: cables awaiting angel processing
│   └── <angel-id>/
├── _outbox/                # IGNORED: sent cables (audit trail)
├── _locks/                 # IGNORED: active lock during execution
├── _logs/                  # IGNORED: raw stdout/stderr per invocation + .meta.json
│   └── <angel-id>/
├── _cursors/               # IGNORED: per-angel newspaper byte offsets
├── _archive/               # IGNORED: archived old files (by month)
├── _root/
│   └── angel.md            # Root angel memory file (TRACKED)
└── src/
    └── auth/
        └── angel.md        # Per-folder angel memory (TRACKED)
```

Angel IDs mirror the folder path: `/` → `-`, literal `-` in a segment name → `--`. The root angel is `_root`. Examples: `src/auth` → `src-auth`, `src/my-component` → `src-my--component`.

---

## Angel lifecycle

```
[init / onboard]
      |
      v
  status: draft              Angels start here after init or onboard.
      |                      Excluded from sweep. Visible in list.
      | angels activate
      v
  status: active             Participates in brief, execute, sweep.
      |
      | (on each execute / sweep)
      v
  angel.md updated           Angel rewrites its own charter section.
      |
      | (optional re-onboard after major refactor)
      v
  status: draft              Reverted to draft for user review.
      |
      | angels activate
      v
  status: active
```

Draft angels are a deliberate review gate: AI-generated context is never automatically trusted. The user promotes after reading the drafted `angel.md`.

---

## Five protocol phases

Each angel invocation runs in one of five phases. The phase determines the prompt template, what the angel is permitted to write, and what response format is expected.

### INIT

Used by `angels init` for greenfield projects. The angel receives a blank territory and writes the skeleton of its `angel.md`. No code to read; the output is a template with placeholder questions.

### DISCOVERY

Used by `angels onboard` for existing codebases. The orchestrator pre-reads priority files from the angel's territory and passes them inline. The angel synthesizes a real `angel.md` body from what it can see — named functions, actual invariants, concrete contracts — and leaves specific questions for anything uncertain.

Priority file selection (in order, capped at 10 files / 50KB total):
1. README files
2. Entry points (`index.*`, `main.*`, `mod.*`, `__init__.*`)
3. Type definitions (`*.d.ts`, `types.*`, `interfaces.*`)
4. Test files (`*.test.*`, `*.spec.*`)
5. Config files (`package.json`, `tsconfig.json`, `pyproject.toml`)

The angel writes the body only; the orchestrator adds frontmatter (`status: draft`, `last_updated`, `last_updated_by`).

### REVIEW

Used by `angels brief`. The angel receives the task brief, reads its charter and any cables in its inbox, then responds with one of:
- `proceed` — task is safe and within scope; angel describes its plan.
- `concerns` — task is risky or unclear; angel asks questions.
- `refuse` — task violates the angel's invariants.

No files are modified during REVIEW.

### EXECUTE

Used by `angels execute`. The angel receives the approved brief and performs the changes. On success it responds with `done`, updates its `angel.md` (if relevant), and sends cables to any affected angels. The orchestrator records the event in `_newspaper.md`.

### SWEEP

Used by `angels sweep`. Each active angel runs in maintenance mode: it reads its territory, reviews its `angel.md` for drift, updates it if needed, and may send `fyi` or `invariant_violation` cables. In v1, sweep is report-only — angels do not make code changes.

---

## Backend adapter pattern

Guard Angels is backend-agnostic. The adapter interface is:

```typescript
interface BackendAdapter {
  name: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
}

interface InvokeOptions {
  prompt: string;      // full prompt text
  cwd: string;         // project root
  timeoutMs: number;
  extraArgs?: string[];
}

interface InvokeResult {
  stdout: string;
  stderr: string;
  code: number;
  sessionId?: string;  // extracted from stdout if the backend emits one
}
```

`pickAdapter()` in `src/backend/factory.ts` inspects the first token of `angel_cmd` to select the adapter. The `GUARD_ANGELS_BACKEND_CMD` environment variable overrides `_config.yml`.

| Adapter | Detection | Prompt delivery | Session ID |
|---------|-----------|-----------------|------------|
| `ClaudeAdapter` | first token = `claude` | Last positional CLI argument | Regex on stdout |
| `CodexAdapter` | first token = `codex` | Last positional CLI argument | Regex on stdout |
| `DroidAdapter` | first token = `droid` | Last positional CLI argument | None |
| `GenericAdapter` | fallback | stdin | None |

The Claude adapter passes the prompt as the last CLI argument (not stdin). This is required because `claude -p` reads the task from the first non-flag argument.

---

## Lock mechanism

Only one angel can be invoked at a time. The global lock lives at `.angels/_locks/orchestrator.lock`.

Acquire sequence (`src/locks/lock.ts`):
1. `writeFileSync(lockPath, content, { flag: 'wx' })` — exclusive create; fails with `EEXIST` if already present.
2. If `EEXIST`: read existing lock, check staleness (PID dead or TTL elapsed).
3. If stale: `unlinkSync` then retry (up to 10 attempts).
4. If live: throw — operator must wait or clean up manually.

The lock file contains `pid`, `started_at`, and `ttl_ms`. TTL = configured angel timeout + 30 seconds of padding. `releaseLock` only unlinks if `pid` matches the current process — prevents a slow process from releasing a lock it no longer owns.

---

## Newspaper and cable messaging

### Newspaper (`_newspaper.md`)

An append-only event log. Every significant event — cable sent, brief filed, execute completed, sweep run — appends a timestamped entry. The `angels newspaper` command reads from the byte offset stored in `_cursors/<angel-id>` (not yet used by v1 commands, but the infrastructure is in place).

Entry format:
```
[2026-05-04T14:32:00Z] [brief] src-auth ← main: "Add rate limiting to login endpoint"
[2026-05-04T14:33:15Z] [execute] src-auth: done
[2026-05-04T14:33:16Z] [cable] src-auth → src-api: breaking_change
```

### Cables (`_inbox/`, `_outbox/`)

Point-to-point messages between angels. Four cable types:
- `breaking_change` — sender's public contract changed in a way receivers must adapt to.
- `fyi` — informational, no action required.
- `review_request` — sender requests the receiver review a proposed change.
- `invariant_violation` — sender detected that a receiver's invariant was violated.

Cables are written to `_inbox/<receiver-id>/` by the sender. The receiver reads them during its next invocation (EXECUTE or SWEEP) via `angels inbox <id>`. Processed cables are moved to `_outbox/`.

---

## angel.md format

```
---
status: draft | active
last_updated: <ISO 8601>
last_updated_by: main | sweep | self
---

## Charter
What this folder owns and why it exists.

## Public contract
Exports, APIs, events this angel is responsible for.

## Invariants
Rules that must always hold. Angels refuse briefs that would violate these.

## Dependencies
Which other angels' territories this one depends on.

## Open questions
Specific unknowns the angel identified during DISCOVERY or EXECUTE.
```

Frontmatter is parsed and validated by `src/angels/memory.ts` using Zod. Writes are atomic: a temp file is written then `rename()`d over the target, preventing partial writes from corrupting the file.

---

## Size limits and context budget

| Input | Cap | Location |
|-------|-----|----------|
| `AGENTS.md` / `CLAUDE.md` seed | 100KB | `src/angels/ingest.ts` |
| DISCOVERY priority files (total) | 50KB | `src/protocol/discovery.ts` |
| DISCOVERY priority file (per file) | 5KB, 200 lines | `src/protocol/discovery.ts` |
| DISCOVERY priority files (count) | 10 files | `src/protocol/discovery.ts` |
| DISCOVERY file listing | 500 lines | `src/protocol/discovery.ts` |

All caps inject a truncation notice so the angel knows it received incomplete data.
