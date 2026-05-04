# Changelog

All notable changes to Guard Angels are documented here.

## [Unreleased]

### Added

- `angels onboard` command — runs the DISCOVERY phase on existing codebases. The orchestrator pre-reads priority files from each angel's territory and passes them inline; the angel synthesizes a real `angel.md` body with named functions, actual invariants, and concrete contracts. Angels start as `status: draft`; the user reviews them, then promotes with `angels activate`.
- `angels activate` command — promotes draft angels to `status: active`. Accepts a single angel ID or `--all`.
- `angels onboard --angel <id>` — re-onboard a single angel after a major refactor without touching others.
- `angels onboard --force` — skip the active-context overwrite prompt; useful in CI or automated contexts.
- `angels onboard --auto-activate` — activate angels immediately after DISCOVERY without a separate `activate` step.
- DISCOVERY as the fifth protocol phase. The full phase sequence is now: INIT → DISCOVERY → REVIEW → EXECUTE → SWEEP.
- Auto-created `.angels/.gitignore` during `angels init`. Tracked: `_config.yml`, `*/angel.md`, `_newspaper.md`. Ignored: `_briefs/`, `_responses/`, `_logs/`, `_cursors/`, `_locks/`, `_archive/`. Angel context now travels with the branch; teammates share the same angel knowledge.
- One-line `onboard` tip printed by `angels init` when existing source folders are detected in the project root.
- Recursive file listing in the DISCOVERY context: uses `readdirSync({ recursive: true })`, depth cap of 3, output capped at 500 lines with a truncation notice.
- Priority file selection for DISCOVERY context: README files → entry points (`index.*`, `main.*`, `mod.*`, `__init__.*`) → type definitions (`*.d.ts`, `types.*`, `interfaces.*`) → test files (`*.test.*`, `*.spec.*`) → config files (`package.json`, `tsconfig.json`, `pyproject.toml`). Capped at 10 files / 50KB total; each file capped at 5KB / 200 lines.

### Fixed

- **Path traversal in `angelIdToPath`** (`src/paths/resolve.ts`): a crafted angel ID such as `..--..--etc` could decode to a path that escapes the project root. Two defenses were added: (1) after decoding, reject any path whose segments include `..`; (2) resolve the decoded path against a sentinel absolute root and verify the result starts with that sentinel — a belt-and-suspenders check that catches traversal that slips past the segment check.

- **Lock race in `acquireLock`** (`src/locks/lock.ts`): the original implementation used `writeFileSync` without an exclusive flag, creating a TOCTOU race when checking for stale locks. Fixed by using `flag: 'wx'` (exclusive create), which fails atomically with `EEXIST` if the lock file already exists. A retry loop handles the stale-lock case: if the existing lock belongs to a dead PID or has exceeded its TTL, it is removed and the atomic write is retried (up to 10 attempts). `releaseLock` now only unlinks if the PID matches the current process, preventing a slow process from releasing a lock it no longer owns.

- **DISCOVERY prompt delivery in `ClaudeAdapter`** (`src/backend/claude.ts`): the adapter was piping the prompt via stdin. `claude -p` reads the task from the first non-flag CLI argument, not from stdin — piped input was silently ignored, causing all DISCOVERY invocations to receive an empty task. Fixed by appending the prompt as the last positional argument: `[...baseArgs, ...(extraArgs ?? []), prompt]`. The `GenericAdapter` still uses stdin for backends that expect it.

- **Unbounded file reads** (`src/angels/ingest.ts`, `src/protocol/discovery.ts`): seed files (`AGENTS.md` / `CLAUDE.md`) and DISCOVERY priority files had no size cap, allowing large files to exhaust the angel's context window. Limits applied:

  | Source | Limit |
  |--------|-------|
  | Seed file (`AGENTS.md` / `CLAUDE.md`) | 100KB; truncated with notice |
  | DISCOVERY priority files (total) | 50KB across all files |
  | DISCOVERY priority file (per file) | 5KB snippet, 200 lines |
  | DISCOVERY priority files (count) | 10 files max |
  | DISCOVERY file listing | 500 lines, then `... (truncated)` |

  All truncations inject a notice into the prompt so the angel knows it received incomplete data rather than silently operating on a partial view.
