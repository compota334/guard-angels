# Changelog

All notable changes to Guard Angels are documented here.

## [Unreleased]

### Added

- **Direct write mode** for DISCOVERY phase: when `memory.target_pct > 5%`, the angel writes `angel.md` directly to disk instead of embedding it inside PROPOSED PLAN. Eliminates the response-file throughput bottleneck for large memory files.
- **Chunked writing** for DISCOVERY phase: when the estimated `angel.md` body exceeds 50 KB, generation is split into ~50K-token chunks across multiple backend invocations. Each chunk appends to the same `angel.md` file; sections are pre-assigned per chunk.
- **`memory` configuration** in `_config.yml`: `memory.target_pct` (1–100, default 25) controls the percentage of context window dedicated to angel memory; `memory.max_tokens` overrides `target_pct` with an absolute budget.
- **Per-angel memory overrides**: each angel entry in `_config.yml` can specify its own `memory` block.
- **`--target-pct <n>` and `--max-tokens <n>` CLI flags** for `angels onboard` — override the configured memory budget for a single invocation.
- **Deep context reading** in DISCOVERY: files are classified by value (`high` / `medium` / `low`); high-value files are read in full with automatic boilerplate filtering (standard imports, framework decorators, trivial JSDoc).
- **Boilerplate filters** (`src/protocol/discovery-filters.ts`): filter out standard Node.js imports, Angular/NestJS decorators, trivial JSDoc, and framework configuration lines from the context passed to the angel.
- **Chunk planner** (`src/protocol/discovery-chunker.ts`): `buildChunkPlan()` calculates the optimal chunk count and section assignment based on target token budget and backend output limits.
- **`appendAngelMd()`** in memory module: appends new body content to an existing `angel.md` file while preserving frontmatter, supporting the chunked writing pipeline.
- **Integration tests** for the complete DISCOVERY pipeline: direct write, chunked writing, deep context reading, boilerplate filtering, and CLI flag parsing.
- **Benchmark tests** comparing angel.md quality (coverage density, section completeness) between legacy and enhanced pipelines.

### Changed

- **Protocol phases documentation** updated in README.md: DISCOVERY phase now describes direct write and chunked writing.
- **Commands table** updated: `angels onboard` now documents `--target-pct` and `--max-tokens` flags.
- **New "Angel memory system" section** in README.md explaining deep context reading, direct write, chunked writing, and memory configuration.
- **`docs/redesign-angel-md-pipeline.md`** status changed from "Propuesta" to "Implementado"; all roadmap checkboxes for Fases 3–5 marked as completed.

### Fixed

- `angels onboard` now accepts `--target-pct` and `--max-tokens` flags. Flags are validated against schema bounds (1–100 for target_pct, positive integer for max_tokens).
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
