# Changelog

All notable changes to Guard Angels are documented here.

## [Unreleased]

### Changed

- **Project name unified to "Guard Angels"**: remaining singular "Guard Angel" references updated across docs, log prefixes (`[guard-angels]`), and test temp-dir prefixes. The agent prompt intentionally keeps "You are a Guard Angel" because it addresses one individual angel.

### Fixed

- **`angels init --manual` path traversal**: folder paths that resolve outside the project root (absolute paths or `../` escapes) are now rejected; accepted paths are normalized relative to the root (`./src/auth/` becomes `src/auth`).
- **`angels init --manual` dropped piped input**: the prompt loop now consumes lines through readline's async iterator instead of chained `rl.question()` calls, so non-interactive input (e.g. `angels init --manual < folders.txt`) no longer silently loses lines.
- **Boilerplate statistics mismatch in deep discovery**: `boilerplateLinesSkipped` / `usefulLinesKept` are now computed from the actually filtered (aggressive) content. Previously they came from a second non-aggressive filter pass, over-reporting kept lines and doubling the filtering work.
- **Dense template decision now matches the memory budget**: `shouldUseDenseTemplate` mirrors `resolveMemoryConfig` — an explicit `memory.max_tokens` overrides `target_pct`, so a small absolute budget no longer selects the dense template (and vice versa).
- **Stale-lock PID probing**: `EPERM` from `kill(pid, 0)` is now treated as "process alive" (only `ESRCH` means gone), so locks owned by processes of another user are not reclaimed while the owner is still running.
- **Log stream descriptor leak**: `createLogStreams` closes the stdout descriptor if opening the stderr log file fails.
- **Version alignment**: `package.json` version updated to 0.2.0 to match this changelog.

### Removed

- Dead code: the unused `buildDiscoveryPrompt` wrapper and duplicate `useDenseTemplate` helper, `getBoilerplateStats`, `SUPPORTED_LANGUAGES`, and export-only surface for internal types (`BoilerplateFilter`, `BoilerplateStats`, `SOURCE_EXTENSIONS`).
- Duplication: scaffold/binary filter constants consolidated into `src/protocol/discovery-shared.ts` (previously copied in `discovery.ts` and `discovery-enhanced.ts`); the response summary printer shared by `brief` and `do` extracted to `src/commands/response-summary.ts`.

### Added

- Unit tests for `handleQuestionsForMain`, `resolveMemoryConfig`, and `GUARD_ANGELS_PROMPT_WARN_BYTES` parsing; integration test for `init --manual` path traversal and input normalization.

## [0.2.0] - 2026-07-03

### Added

- **MIT license**: the project is now open source under the MIT license (`LICENSE.md`).
- **npm publishing**: the package is published as `@guard-angels/cli` with public access; `package.json` gained `files`, `engines`, `publishConfig`, and repository metadata, plus `prepack`/`prepublishOnly` guards.
- **Shell completions**: new `angels completion` command generating bash and zsh completion scripts.
- **CI/CD workflows**: GitHub Actions `ci.yml` (build, lint, and test on Node 22/23 for pushes and PRs against `main`) and `publish.yml` (publish to npm on `v*` tags).
- **Contributing documentation**: `CONTRIBUTING.md` (setup, workflow, coding standards, PR checklist), `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1), and `SECURITY.md` (vulnerability reporting policy).
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

- **README restructured** around the npm install experience: installation via `npm install -g @guard-angels/cli` is now the entry point, with quick start, commands, and protocol documentation reorganized accordingly.
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
