# Guard Angels Architecture

This document describes the internal structure and key design decisions of the Guard Angels CLI.

**Last verified against the code on 2026-07-08 (v0.3.0).** Earlier revisions of this document described the pre-0.3 world (markdown responses, a single global lock); if a statement here ever disagrees with the code, the code wins and this file should be fixed.

---

## Repository structure

```
src/
├── bin/angels.ts           # Executable entry (shebang wrapper around cli.ts)
├── cli.ts                  # Registers all commands via commander
├── version.ts              # CLI_VERSION read from package.json at runtime
├── config/
│   ├── load.ts             # loadConfig(): reads and validates _config.yml
│   └── schema.ts           # Zod schemas: Config/ConfigInput, AngelEntry, checks, newspaper, housekeeping
├── commands/               # One file per CLI command
│   ├── init.ts  onboard.ts  activate.ts  create.ts  retire.ts  list.ts  show.ts
│   ├── brief.ts  execute.ts  do.ts  ask.ts  sweep.ts  doctor.ts
│   ├── cable.ts  inbox.ts  newspaper.ts  chat.ts  note.ts
│   ├── guard-check.ts      # Territory check for edit hooks (exit 0/2)
│   ├── hooks.ts            # Manage the Claude Code PreToolUse hook in .claude/settings.json
│   ├── stats.ts            # collectStats() data core + showStats() printer
│   ├── response-summary.ts # Shared human-readable response printer (brief/do)
│   └── completion.ts       # Shell completion script generator
├── angels/
│   ├── identify.ts         # Heuristic folder candidate detection
│   ├── ingest.ts           # Read AGENTS.md / CLAUDE.md seed files
│   ├── memory.ts           # Read/write angel.md with validated frontmatter
│   ├── journal.ts          # Deterministic ## Journal appends (no AI invocation)
│   ├── template.ts         # angel.md templates (dense template headings are load-bearing)
│   ├── draft.ts            # Draft angel.md creation
│   └── registry.ts         # AngelRegistry: list, lookup by ID/path, root validation
├── protocol/
│   ├── orchestrate.ts      # invoke(): lock → prompt → spawn → log → parse
│   ├── prompt.ts           # buildPrompt(): cache-aware layout (stable prefix, volatile tail)
│   ├── brief.ts            # writeBrief() / parseBrief()
│   ├── response.ts         # JSON response parse/format (camelCase internal view)
│   ├── response-schema.ts  # Strict Zod schema for the on-disk JSON response contract
│   ├── discovery*.ts       # DISCOVERY context building, filters, chunked writing
│   └── parser-utils.ts     # Shared date/seq helpers
├── backend/
│   ├── adapter.ts          # BackendAdapter interface (InvokeOptions/InvokeResult/TokenUsage)
│   ├── factory.ts          # pickAdapter(): selects adapter from angel_cmd's first token
│   ├── claude.ts  codex.ts  droid.ts  generic.ts
├── messaging/
│   ├── cables.ts           # writeCable() / readInbox() / formatCablesAsContext(), quarantine
│   ├── newspaper.ts        # Atomic appends, offset reads, rotation
│   ├── cursors.ts          # Generation-stamped per-angel cursors
│   └── questions.ts        # questions_for_main handling
├── locks/lock.ts           # Per-scope file locks (orchestrator-<angelId>.lock), TTL + PID staleness
├── logs/log.ts             # createLogStreams() / writeLogMeta() (.meta.json telemetry)
├── paths/
│   ├── layout.ts           # Path helpers for .angels/ subdirs
│   └── resolve.ts          # angelIdToPath() / pathToAngelId(): safe encoding
└── util/concurrency.ts     # mapWithConcurrency() sliding-window pool, clampParallel (1-8)
```

---

## .angels/ directory layout

```
.angels/
├── .gitignore              # Auto-created by init; excludes ephemeral dirs
├── _config.yml             # Project config: backend cmd, angel list, checks, sweep settings
├── _newspaper.md           # Append-only event log (cable, brief, execute, sweep)
├── _newspaper.generation   # Current newspaper generation number (bumped on rotation)
├── _briefs/                # IGNORED: outgoing briefs (main → angels)
│   └── <angel-id>/
├── _responses/             # IGNORED: angel responses (JSON)
│   └── <angel-id>/
├── _inbox/                 # IGNORED: cables awaiting delivery (+ _quarantine/ for malformed)
│   └── <angel-id>/
├── _outbox/                # IGNORED: sent cables (audit trail)
├── _locks/                 # IGNORED: per-angel locks during execution
├── _logs/                  # IGNORED: raw stdout/stderr per invocation + .meta.json telemetry
│   └── <angel-id>/
├── _cursors/               # IGNORED: per-angel newspaper cursors (generation + byte offset)
├── _chat/                  # IGNORED: per-angel operational chat side-channel
├── _archive/               # IGNORED: archived old files
│   ├── <YYYY-MM>/          #   housekeeping moves old briefs/responses/logs here (paths preserved)
│   ├── newspaper/          #   rotated newspapers (<YYYY-MM>-gen<N>.md)
│   └── journal/            #   journal overflow per angel
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

Each angel invocation runs in one of five phases. The phase determines the prompt template, what the angel is permitted to write, and what response is expected. All responses are JSON documents validated against the strict schema in `src/protocol/response-schema.ts` (see the README "Response format" section for the user-facing contract).

### INIT

Used by `angels init` for greenfield projects. The angel receives a blank territory and writes the skeleton of its `angel.md`. No code to read; the output is a template with placeholder questions.

### DISCOVERY

Used by `angels onboard` for existing codebases. The orchestrator pre-reads priority files from the angel's territory and passes them inline. The angel synthesizes a real `angel.md` body from what it can see (named functions, actual invariants, concrete contracts) and leaves specific questions for anything uncertain. Onboarding runs up to `--parallel` angels concurrently (default 4).

Priority file selection (in order, capped at 10 files / 50KB total):
1. README files
2. Entry points (`index.*`, `main.*`, `mod.*`, `__init__.*`)
3. Type definitions (`*.d.ts`, `types.*`, `interfaces.*`)
4. Test files (`*.test.*`, `*.spec.*`)
5. Config files (`package.json`, `tsconfig.json`, `pyproject.toml`)

The angel writes the body only; the orchestrator adds frontmatter (`status: draft`, `last_updated`, `last_updated_by`).

### REVIEW

Used by `angels brief`. The angel receives the task brief plus any pending inbox cables (injected as context and archived after delivery, unless `--no-consume-cables`), reads its charter, then answers with a verdict:
- `proceed` (exit 0): task is safe and within scope; angel describes its plan.
- `concerns` (exit 2): task is risky or unclear; the response must include a proposed plan.
- `refuse` (exit 3): task violates the angel's invariants; the refusal cites the violated `INV-NNN` ids.

No files are modified during REVIEW.

### EXECUTE

Used by `angels execute`. The angel receives the approved brief and performs the changes, answering `done` or `error`. After a done verdict the orchestrator:
1. Verifies territory containment by diffing a filesystem snapshot. With `execute.strict_territory` (the default), out-of-territory writes block the execute (exit 1) and new files are rolled back.
2. Runs the territory's proof-of-done checks (`checks:` in `_config.yml`), storing their output under `_logs/` as evidence; any failing check turns the execute into exit 1 (changes are kept for inspection, never silently undone).
3. Appends one factual line to the angel's `## Journal` and records the event in `_newspaper.md`.

The angel subprocess runs with `GUARD_ANGELS_EXECUTING=<angel-id>` in its environment, which exempts it from the edit-guard hook (its writes are verified post-hoc by step 1).

### SWEEP

Used by `angels sweep`. Each active angel runs in maintenance mode: it reads its territory, reviews its `angel.md` for drift, folds accumulated `## Journal` facts into its curated sections, and may send `fyi` or `invariant_violation` cables. Sweep is report-only (no code changes) and runs up to `--parallel` angels concurrently. Before waking anyone, sweep rotates an oversized newspaper and archives old briefs/responses/logs per `housekeeping.archive_after_days`.

---

## Backend adapter pattern

Guard Angels is backend-agnostic. The adapter interface (`src/backend/adapter.ts`):

```typescript
interface InvokeOptions {
  prompt: string;                 // full prompt text
  cwd: string;                    // project root
  timeoutMs: number;
  extraArgs?: string[];
  env?: Record<string, string>;   // per-spawn env (e.g. GUARD_ANGELS_EXECUTING)
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

interface InvokeResult {
  stdout: string;
  stderr: string;
  code: number;
  sessionId?: string;
  usage?: TokenUsage;   // only adapters with structured output provide this
  costUsd?: number;
}

interface BackendAdapter {
  name: string;
  invoke(opts: InvokeOptions): Promise<InvokeResult>;
  extractSessionId?(stdout: string): string | null;
}
```

`pickAdapter()` in `src/backend/factory.ts` inspects the first token of `angel_cmd` to select the adapter. The `GUARD_ANGELS_BACKEND_CMD` environment variable overrides `_config.yml`.

| Adapter | Detection | Prompt delivery | Session / telemetry |
|---------|-----------|-----------------|---------------------|
| `ClaudeAdapter` | first token = `claude` | Last positional CLI argument | Appends `--output-format json` (unless the command already sets a format) and parses the result envelope: `session_id`, token usage, `total_cost_usd`. A zero exit with an unparseable envelope fails loudly. |
| `CodexAdapter` | first token = `codex` | Last positional CLI argument | Regex `thread_id` scraping on stdout |
| `DroidAdapter` | first token = `droid` | Last positional CLI argument | None |
| `GenericAdapter` | fallback | stdin | None |

Session id, usage and cost land in the invocation's `.meta.json` (via `LogMeta` in `src/logs/log.ts`); `angels stats` aggregates them.

---

## Lock mechanism

Locks are per angel, not global: each invocation acquires `.angels/_locks/orchestrator-<angelId>.lock`, so different angels run concurrently (onboard and sweep use a sliding-window pool of up to 8) while the same angel can never run twice at once.

Acquire sequence (`src/locks/lock.ts`):
1. `writeFileSync(lockPath, content, { flag: 'wx' })`: exclusive create; fails with `EEXIST` if already present.
2. If `EEXIST`: read existing lock, check staleness (PID dead or TTL elapsed). `EPERM` from probing a PID counts as alive; only `ESRCH` means gone.
3. If stale: `unlinkSync` then retry (up to 10 attempts).
4. If live: throw; the operator must wait or clean up manually.

The lock file contains `pid`, `started_at`, and `ttl_ms`. TTL = configured angel timeout + 30 seconds of padding. `releaseLock` only unlinks if `pid` matches the current process, which prevents a slow process from releasing a lock it no longer owns.

---

## Newspaper and cable messaging

### Newspaper (`_newspaper.md`)

An append-only event log. Every significant event (cable sent, brief filed, execute completed, sweep run) appends a timestamped entry as a single `O_APPEND` write. Entries are capped at 3800 bytes (details truncated with a marker) because append atomicity on Linux only holds below `PIPE_BUF` (4096); an interleaved entry would corrupt the log for every reader.

Per-angel cursors (`_cursors/<angel-id>`) are generation-stamped JSON: `{"generation": N, "offset": B}`. `readNewspaperSince` opens the file and reads only the bytes past the cursor. When the newspaper exceeds `newspaper.max_bytes` (default 5 MB), sweep or `doctor --archive` rotate it to `_archive/newspaper/<YYYY-MM>-gen<N>.md` and bump `_newspaper.generation`; rotation happens only at those single-writer moments, never inside an append. A cursor from an archived generation (or a corrupted / pre-0.3 plain-number cursor) resets to 0 with a printed notice: entries are re-presented once rather than silently skipped (at-least-once delivery).

Entry format:
```
[2026-05-04T14:32:00Z] [brief] src-auth ← main: "Add rate limiting to login endpoint"
[2026-05-04T14:33:15Z] [execute] src-auth: done
[2026-05-04T14:33:16Z] [cable] src-auth → src-api: breaking_change
```

### Cables (`_inbox/`, `_outbox/`)

Point-to-point messages between angels. Four cable types:
- `breaking_change`: sender's public contract changed in a way receivers must adapt to.
- `fyi`: informational, no action required.
- `review_request`: sender requests the receiver review a proposed change.
- `invariant_violation`: sender detected that a receiver's invariant was violated.

Cables are written to `_inbox/<receiver-id>/` with exclusive-create filenames (a numeric suffix resolves same-second collisions). Cable files are validated on read; malformed ones are quarantined under `_inbox/<id>/_quarantine/` instead of crashing the reader. `brief`, `do` and `execute` inject pending cables as context by default and archive them only after actual delivery (`--no-consume-cables` opts out); `angels inbox <id>` shows them manually.

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
Numbered rules (INV-001, INV-002, ...) that must always hold. Angels refuse
briefs that would violate these, citing the ids. Ids are stable and never
reused; a dead invariant's id dies with it.

## Dependencies
Which other angels' territories this one depends on.

## Open questions
Specific unknowns the angel identified during DISCOVERY or EXECUTE.

## Journal
Timestamped facts appended mechanically by the CLI (execute outcomes,
`angels note`). Folded into the curated sections at the next sweep.
```

Frontmatter is parsed and validated by `src/angels/memory.ts` using Zod (optional fields: `notes`, `memory_target_pct`, `memory_max_tokens`, `territory_size`, `code_coverage_pct`). Writes are atomic: a temp file is written then `rename()`d over the target. Journal appends deliberately do not touch `last_updated`, so it keeps meaning "last curated update" (this is what the staleness metric in `angels stats` relies on).

Note: the dense template's section headings (in `src/angels/template.ts`) are matched by string in the chunked-discovery pipeline (`discovery-chunker.ts` and `getAllPreviousSections` in `prompt.ts`). Renaming a heading requires updating both.

---

## Size limits and context budget

| Input | Cap | Location |
|-------|-----|----------|
| `AGENTS.md` / `CLAUDE.md` seed | 100KB | `src/angels/ingest.ts` |
| DISCOVERY priority files (total) | 50KB | `src/protocol/discovery.ts` |
| DISCOVERY priority file (per file) | 5KB, 200 lines | `src/protocol/discovery.ts` |
| DISCOVERY priority files (count) | 10 files | `src/protocol/discovery.ts` |
| DISCOVERY file listing | 500 lines | `src/protocol/discovery.ts` |
| Newspaper entry | 3800 bytes | `src/messaging/newspaper.ts` |
| Journal | 200 bullets (overflow to `_archive/journal/`) | `src/angels/journal.ts` |

All caps inject a truncation notice so the angel knows it received incomplete data.
