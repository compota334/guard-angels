# Design: Guard Angel Support for Pre-Existing Projects

**Date:** 2026-05-02
**Status:** IMPLEMENTED (2026-05-04)

> **Implementation note:** This document was a proposal written 2026-05-02. All core features were implemented by 2026-05-04. Sections are marked [IMPLEMENTED], [PROPOSED], or [DEFERRED] to show current state. The "Implementation Notes" section at the bottom documents fixes applied during implementation.

---

## Problem Statement [IMPLEMENTED]

Guard Angel's `init` command was designed for greenfield projects: it detects candidate folders and writes blank `angel.md` templates. Three real-world scenarios expose gaps:

1. **Clone and adopt** — user clones a mature GitHub repo and wants Guard Angel supervision immediately.
2. **Mid-project adoption** — user adds Guard Angel to a project that already has substantial code, docs, and conventions.
3. **Branch-aware context** — user works across git branches where folder structure and concerns differ; angels carry stale context from a different branch.

In all three cases, angels start with zero domain knowledge. The first `sweep` produces generic reports. The user must manually fill in every `angel.md` — the exact work Guard Angel is supposed to automate.

---

## Perspective 1: UX Designer

### Current pain point [IMPLEMENTED]

The `init` flow asks the user to select folders then creates empty templates with comment placeholders. For a project with 50,000 lines of code, this produces 8–12 angel.md files that each say:

```markdown
## Charter
<!-- What this folder owns. -->
```

The user stares at blank files and has to do the knowledge-extraction work by hand.

### Ideal user journey [IMPLEMENTED]

```
git clone github.com/org/large-api && cd large-api
angels onboard

# Detected 9 candidate folders:
#   [1] src/auth       — authentication and session management
#   [2] src/api        — HTTP route handlers
#   ...
# Select folders [all / numbers / none]: all
#
# Onboarding src/auth...   done (23 files read, angel.md drafted)
# Onboarding src/api...    done (41 files read, angel.md drafted)
# ...
# 9 angels drafted. Run "angels list" to review, then "angels activate --all".
```

Angel.md files come out with real content — named functions, actual invariants, concrete contracts — not placeholders.

### Command naming recommendation [IMPLEMENTED]

`angels onboard` — a separate subcommand, not a flag on `init`.

**Rationale:**

| Option | Verdict |
|--------|---------|
| `angels init --onboard` | Confusing: init creates structure; onboarding is a different concern |
| `angels init --existing` | Misleading: init still runs discovery; the distinction is unclear |
| `angels onboard` | Semantically clear, discoverable in `--help`, composable with `--angel` |

`init` should detect that the project has existing code and print a one-line tip suggesting `onboard`. It does not run discovery itself.

### Draft status as a review gate [IMPLEMENTED]

Angels produced by `onboard` start as `status: draft`. Draft angels:

- Appear in `angels list` (marked with a "draft" badge)
- Are excluded from `sweep` by default (so garbage context does not pollute the newspaper)
- Become active via `angels activate <id>` or `angels activate --all`

This gives the user a natural review moment before angels start influencing decisions.

---

## Perspective 2: Architect

### Separation of concerns [IMPLEMENTED]

Current `init` conflates two jobs:

1. Create `.angels/` directory structure
2. Draft `angel.md` (attempts to read `AGENTS.md`/`CLAUDE.md` as seed)

For existing projects a third job is needed:

3. Discover and internalize existing project knowledge

Implemented clean boundary:

```
angels init      → structure only + blank templates (fast, no AI unless seed file found)
angels onboard   → structure + DISCOVERY phase per angel (AI-heavy, reads code)
angels create    → adds one angel to an existing project (no DISCOVERY by default)
```

`onboard` can be run:
- Fresh, on a project with no `.angels/` yet (combines `init` and DISCOVERY)
- On a project that already has `.angels/` (re-onboard all or specific angels after a big refactor)

### DISCOVERY as a first-class protocol phase [IMPLEMENTED]

The current protocol has four phases: INIT, REVIEW, EXECUTE, SWEEP.

DISCOVERY is now the fifth phase.

**DISCOVERY phase contract:**

| Axis | Constraint |
|------|-----------|
| Reads | Its own territory (recursive), priority file list provided by orchestrator |
| Writes | Only `.angels/{path}/angel.md` — the orchestrator captures the body and writes the file |
| Output format | The `angel.md` body (no frontmatter; orchestrator handles frontmatter) |
| Allowed response states | `done` (with angel.md body), `error` |

DISCOVERY differs from INIT:

- **INIT** — angel is activated for the first time in a greenfield project; no pre-existing code.
- **DISCOVERY** — angel reads an existing codebase and synthesizes its `angel.md` from it.

### Context sources for bootstrapping [IMPLEMENTED]

| Priority | Source | Rationale |
|----------|---------|-----------|
| 1 | `{folder}/README.md` | Human-written intent; highest density |
| 2 | Entry points (`index.*`, `mod.*`, `__init__.*`, `main.*`) | Public surface |
| 3 | Type definitions (`*.d.ts`, `types.*`, `interfaces.*`) | Contracts |
| 4 | Test files (`*.test.*`, `*.spec.*`) | Behavioral specification |
| 5 | Config files (`package.json`, `tsconfig.json`, `pyproject.toml`) | Dependencies and scripts |
| 6 | All other source files | Complete picture |

The orchestrator pre-reads priority files and includes their content in the DISCOVERY prompt. The angel is given the full recursive file listing and the pre-read content; it synthesizes the `angel.md` body from what it has.

**Token budget guidance in the prompt:** include a directive like "Prioritize breadth over depth; name real artifacts you can see, mark anything uncertain with a specific question rather than a generic TODO."

### Idempotency and safety [IMPLEMENTED]

- `onboard` on an angel with `status: active` prompts: `Angel src-auth already has active context. Overwrite? (y/N)` — default no.
- `onboard` on a `status: draft` angel overwrites silently (the user has not promoted it yet).
- A `--force` flag skips the prompt for automation contexts.
- Re-onboarding after a major refactor is a valid, supported workflow.

### Branch context strategy [PROPOSED]

**Recommendation: structured "Branch notes" section in angel.md.**

```markdown
## Branch notes
<!-- Short-lived, branch-specific overrides. Remove before merging. -->

### feature/new-auth (active)
- src/auth is being rewritten; legacy auth/ subdirectory is deprecated.
- New canonical interfaces live in src/auth-v2/.
```

This keeps one source of truth per angel, plays well with git merges (conflicts surface exactly where context diverges), and requires zero new tooling.

**Alternative considered and rejected:** per-branch angel files at `.angels/{path}/angel.{branch}.md`. Rejected because it multiplies files, breaks `sweep` (which branch does it read?), and is harder to merge.

*Status: not implemented as tooling. This is a recommended practice for users, not a code change.*

---

## Perspective 3: Developer

### What changes and where [IMPLEMENTED]

**`src/commands/onboard.ts`** — implemented. Loads config, selects targets, prompts on active angels, calls `buildDiscoveryContext`, writes the brief, invokes the backend via `orchestrate.invoke()`, writes `angel.md` with `status: draft` (or `active` with `--auto-activate`).

**`src/protocol/prompt.ts` — DISCOVERY case** — implemented. The DISCOVERY phase prompt instructs the angel to read the provided file listing and priority file contents, write a complete `angel.md` body, name real artifacts, and leave specific questions rather than generic TODOs.

**`src/protocol/discovery.ts` — recursive listing** — implemented. `buildRecursiveListing` uses `readdirSync` with `{ recursive: true }`, respects a configurable depth limit (default 3), and caps output at 500 lines. `buildDiscoveryContext` selects priority files by pattern, caps each file at 200 lines / 5KB, and caps the total priority budget at 50KB.

**`src/commands/init.ts`** — implemented. Auto-creates `.angels/.gitignore` during init, and prints a tip suggesting `angels onboard` when source folders are detected.

**`src/commands/activate.ts`** — implemented. Promotes draft angels to active.

**`src/cli.ts`** — both `onboard` and `activate` are registered.

### Implementation order [IMPLEMENTED]

All steps from the proposal were completed:

1. `src/commands/onboard.ts` — command shell
2. DISCOVERY phase in `src/protocol/prompt.ts`
3. Recursive listing in `src/protocol/discovery.ts`
4. `src/commands/init.ts` — `.gitignore` auto-creation and tip
5. `src/commands/activate.ts` — promote draft angels
6. `src/cli.ts` — both new commands registered
7. `angels list` shows draft status
8. Integration tests: `tests/integration/onboard.test.ts`, `tests/integration/activate.test.ts`

---

## Perspective 4: Project Maintainer

### Keeping angels accurate after the initial onboard [DEFERRED]

Onboarding is a one-time bootstrap. The harder problem is drift: code changes, angel.md does not.

**Current mechanism:** angels self-update their `angel.md` during EXECUTE. This works only if briefs flow regularly. Dormant angels drift.

**Proposed: drift detection in SWEEP.** Not yet implemented. During sweep, the orchestrator would compare `angel.md`'s `last_updated` against the newest `git log` modification date within that angel's folder. If the folder has commits newer than the last update by more than N days, the sweep prompt includes a `[DRIFT WARNING]` section.

**Re-onboarding after major refactor:**

```bash
angels onboard --angel src-auth --force
```

This re-runs DISCOVERY on a single angel, overwriting its `angel.md` draft. The user promotes it after review.

### angel.md in version control [IMPLEMENTED]

The `.angels/.gitignore` is auto-created during `init`:

- **Tracked:** `_config.yml`, `*/angel.md`, `_newspaper.md`
- **Ignored:** `_briefs/`, `_responses/`, `_logs/`, `_cursors/`, `_locks/`, `_archive/`

This means:
- Angel context travels with the branch — teammates see the same angel knowledge
- Merging branches merges angel context, making divergence visible as git conflicts
- The newspaper and briefs are ephemeral (machine-generated per session) and should not be in history

### Long-term: `ONBOARD_REQUEST` cable type [DEFERRED]

An angel that detects substantial drift in its sweep could self-report with a structured cable to `_root`. The `_root` angel (or a future `angels doctor` enhancement) could surface a list of pending onboard requests. Not implemented.

---

## Proposed Command Surface [IMPLEMENTED]

| Command | Use case |
|---------|----------|
| `angels init` | New project: create `.angels/` structure + blank templates |
| `angels onboard` | Existing project: create structure + run DISCOVERY on all angels |
| `angels onboard --angel <id>` | Re-onboard one angel after major refactor |
| `angels onboard --force` | Overwrite active angel.md without prompting |
| `angels activate --all` | Promote all draft angels to active after reviewing |
| `angels activate <id>` | Promote one draft angel |
| `angels create <path>` | Add one angel to an existing Guard Angel project (no DISCOVERY) |

---

## Open Questions

1. **Token budget for DISCOVERY.** RESOLVED: 50KB total across all priority files, 5KB per individual file, 200-line snippet per file, max 10 files. A truncation notice is injected when the budget is exceeded.

2. **gitignore parsing.** RESOLVED (pragmatic): The recursive listing uses `fs.readdirSync` with `{ recursive: true }`. It does not shell out to `git ls-files` and does not parse `.gitignore`. This means ignored build artifacts may appear in the listing. Acceptable for v1: the angel is given a listing, not file contents, so the token impact is small.

3. **Activate gate.** DEFERRED: Draft angels are fully excluded from `sweep` in v1. A reduced-participation mode (read-only sweep, no cable sending) is a possible v2 enhancement.

4. **`angels onboard` on a greenfield project.** RESOLVED: `onboard` calls `loadConfig` which throws `ERR_NOT_INITIALIZED` if `.angels/` does not exist. The user must run `angels init` first. Combined flow (onboard calling init internally) was deferred in favor of the simpler two-step UX.

5. **Re-onboard diff.** DEFERRED: `--force` re-onboard overwrites without showing a diff. A before/after diff of `angel.md` would be useful for large angel files; not yet implemented.

---

## Implementation Notes

### DISCOVERY bug: prompt passed via stdin instead of CLI arg

The `ClaudeAdapter` initially passed the prompt via stdin (piped input). This broke DISCOVERY because `claude -p` reads the task from the first non-flag CLI argument, not from stdin. The adapter was rewritten to append the prompt as the last positional argument:

```typescript
const args = [...this.baseArgs, ...(opts.extraArgs ?? []), opts.prompt];
```

This fix is in `src/backend/claude.ts`. The generic fallback adapter still uses stdin for backends that expect it.

### Security fixes applied during implementation

**Path traversal in `angelIdToPath` (`src/paths/resolve.ts`)**

Angel IDs are user-supplied strings decoded to folder paths. A crafted ID such as `..--..--etc` could decode to a path escaping the project root. Two defenses were added:

1. After decoding, reject any path whose segments include `..`.
2. Resolve the decoded path against a sentinel absolute root (`/safe_root_sentinel`) and verify the result starts with that sentinel — a belt-and-suspenders check that catches any traversal that slipped through the segment check.

**Lock race in `acquireLock` (`src/locks/lock.ts`)**

The original implementation used `writeFileSync` without an exclusive flag, creating a TOCTOU race when checking for stale locks. Fixed by using `flag: 'wx'` (exclusive create), which fails atomically with `EEXIST` if the lock file already exists. A retry loop handles the stale-lock case: if the existing lock belongs to a dead PID or has exceeded its TTL, it is removed and the atomic write is retried (up to 10 attempts).

**Size limits to prevent context exhaustion**

Unbounded file reads could exhaust the angel's context window. Limits applied:

| Source | Limit | File |
|--------|-------|------|
| `AGENTS.md` / `CLAUDE.md` seed | 100KB, truncated with notice | `src/angels/ingest.ts` |
| DISCOVERY priority files (total) | 50KB across all files | `src/protocol/discovery.ts` |
| DISCOVERY priority file (per file) | 5KB snippet, 200 lines | `src/protocol/discovery.ts` |
| DISCOVERY priority files (count) | 10 files max | `src/protocol/discovery.ts` |
| DISCOVERY file listing | 500 lines, then `... (truncated)` | `src/protocol/discovery.ts` |

### Current DEFAULT_BACKEND_CMD

```
claude -p --dangerously-skip-permissions
```

Set in `_config.yml` under `backend.angel_cmd`. Override via the `GUARD_ANGELS_BACKEND_CMD` environment variable.
