# Guard Angels

<p>
  <a href="https://www.npmjs.com/package/@guard-angels/cli"><img alt="npm version" src="https://img.shields.io/npm/v/%40guard-angels%2Fcli.svg"></a>
  <a href="LICENSE.md"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://nodejs.org/"><img alt="node version" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg"></a>
  <a href="https://github.com/compota334/guard-angels/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/compota334/guard-angels/actions/workflows/ci.yml/badge.svg"></a>
</p>

**An AI that knows your whole codebase, all the time, all at once.** Guard Angels gives every significant folder in your project its own resident AI agent (an "angel") that permanently knows that territory. When you want to change something, you say it once, and every affected part of your code knows what to change on its side to stay coherent with your intent.

## Why

A single AI coding agent is brilliant inside one context window and blind outside it. On a real codebase it reads a slice, edits that slice, and moves on. Everything the context did not include starts to drift: sibling modules keep stale assumptions, docs rot, and the reasoning behind decisions evaporates the moment the session ends.

Guard Angels flips the model. Instead of one agent with partial knowledge of everything, you get many agents with deep, persistent knowledge of one thing each:

- Every significant folder gets an **angel**: a per-folder agent whose memory file (`angel.md`) holds the *why* of that folder: charter, architecture, public contract, invariants, decision log, known debt.
- Angels never forget. Their memory lives in plain files, committed to git. It survives any session, any model swap, any machine.
- When a change crosses a folder boundary, the angel **cables** the neighbors it affects. The parts of your codebase you did not mention still find out what they need to do to stay coherent.

The result: you talk to your codebase at the level of intent ("add rate limiting to login") and the knowledge of *how that lands everywhere* is already distributed, resident, and awake.

## A little republic for your code

Guard Angels runs your repository like a small, well-run republic:

- **Territories.** Each angel governs one folder. It owns the why of its territory, executes changes inside it, and is accountable for keeping its own records current.
- **Deliberation before action.** You do not command blindly. You *brief* an angel, and it answers `proceed`, `concerns`, or `refuse`, with a plan and questions. It knows its territory better than a fresh context ever could, and it will push back when your request breaks an invariant.
- **Cables.** When a change in one territory affects another, angels send cables (typed messages: `breaking_change`, `fyi`, `review_request`, `invariant_violation`). Cross-border coherence is diplomacy, not luck.
- **The newspaper.** Every brief, execution, cable, and sweep is published to an append-only public record (`_newspaper.md`). Anyone (you, your main agent, a future session) can read what happened and why.
- **You hold the executive.** Nothing executes without your approval. Angels review, warn, plan, and remember; you decide.

No database, no service, no web UI. The whole republic is plain files under `.angels/`, committed to git.

## Quickstart

Requires **Node.js >= 22** and an AI coding CLI on your `PATH` (Claude Code by default; Codex and others are [configurable](#backend-configuration)).

```bash
# One-liner, no install needed:
npx @guard-angels/cli init

# Or install globally and use the angels command:
npm install -g @guard-angels/cli
```

From zero in an existing codebase:

```bash
cd your-project
angels init              # create .angels/ and pick which folders get angels
angels onboard           # angels read the code and write their own memory (angel.md)
angels activate --all    # promote the generated drafts to active

# Delegate your first change (review, then execute):
angels do src-auth "Add rate limiting to the login endpoint"

# After a batch of changes, let angels update their memory and read the log:
angels sweep
angels newspaper
```

That's it: all state lives in plain files under `.angels/`, committed to git. See the [usage guide](#usage-guide) for the full workflow and [Commands](#commands) for the complete reference.

## Installation

### One-liner (npx)

```bash
npx @guard-angels/cli init
```

Runs the CLI without installing anything permanently. Good for trying it out.

### Global install (recommended)

```bash
npm install -g @guard-angels/cli
angels --version
```

### From source

```bash
git clone https://github.com/compota334/guard-angels.git
cd guard-angels
make install
```

`make install` is idempotent: same command for first install and updates. It checks Node version, installs dependencies (if needed), builds, verifies the binary, and links it globally.

### Shell completion (optional)

```bash
# bash
angels completion bash >> ~/.bashrc

# zsh
angels completion zsh > "${fpath[1]}/_angels"
```

## How it works

You keep using your normal AI coding CLI (Claude Code, Codex, etc.) as the "main agent." Guard Angels adds a delegation layer: instead of the main agent editing code directly, it *briefs* the relevant folder angel, reviews the angel's response, then tells it to *execute*. Each angel is a fresh subprocess of your configured AI CLI, given a system prompt built from the angel's persistent memory file (`angel.md`) plus the task brief.

All state lives on disk inside `.angels/`, committed to git. No database, no service, no web UI.

### Protocol phases

Angels operate in five phases:

1. **INIT**: `angels init` bootstraps `.angels/` and writes blank `angel.md` templates. For greenfield projects with no existing code.
2. **DISCOVERY**: `angels onboard` reads an existing codebase and synthesizes a real `angel.md` per angel. AI-heavy; priority files (READMEs, entry points, type definitions, tests) are pre-read and passed inline. Supports **direct write** (angel writes `angel.md` directly instead of via the `proposed_plan` response field) when `memory.target_pct > 5%`, and **chunked writing** (large outputs split into ~50K-token chunks generated sequentially) when estimated `angel.md` exceeds 50 KB.
3. **REVIEW**: `angels brief <angel-id> "<task>"` sends the task to the angel. The angel reads its charter, the code, and the brief, then responds with `proceed`, `concerns`, or `refuse`. No files are modified.
4. **EXECUTE**: `angels execute <angel-id> <brief-path>` re-invokes the angel with approval. The angel makes the changes, updates its `angel.md`, sends cables to affected angels, and reports what it did.
5. **SWEEP**: `angels sweep` wakes every active angel in maintenance mode. Angels review their territory for drift and may send cables. Report-only in v1.

The DISCOVERY pipeline is configured via `memory` in `_config.yml`; see [Angel memory system](#angel-memory-system) for details.

## Usage guide

### New project

```bash
cd your-project
angels init              # interactive: pick which folders get angels
# or: angels init --auto   (accept all heuristic candidates)
# or: angels init --manual (you name the folders explicitly)
```

### Existing project (recommended for most users)

If your project already has code, run DISCOVERY to bootstrap angel context from the source:

```bash
cd your-project
angels init                             # create .angels/ structure
angels onboard                          # run DISCOVERY on all angels
# or: angels onboard --angel src-auth   (single angel only)
# or: angels onboard --force            (overwrite active angels without prompting)

# Review the generated angel.md files, then promote to active:
angels activate --all
# or: angels activate src-auth          (promote a single angel)
```

`init` detects substantial existing code and prints a reminder to run `onboard`. The two steps are kept separate so you can review which folders get angels before committing to DISCOVERY.

### Day-to-day workflow

```bash
# See what was created
angels list

# Add an angel for a folder you missed
angels create src/payments

# Delegate a change to an angel (REVIEW then EXECUTE)
angels brief src-auth "Add rate limiting to the login endpoint"
# Prints the brief path and the angel's response (verdict, concerns, proposed plan)

# If the angel said "proceed", execute: pass the brief path printed above
angels execute src-auth .angels/_briefs/src-auth/2026-05-12T1432-001.md

# Or skip the two phases with a single command
angels do src-auth "Add rate limiting to the login endpoint"
# Runs brief then execute automatically; aborts if angel raises concerns or refuses

# After a batch of changes, let angels update their memory and flag drift
angels sweep

# Read what happened
angels newspaper --since=2026-04-28T00:00:00Z

# Periodic health check
angels doctor
angels doctor --archive --older-than=30
```

## Commands

| Command | Description |
|---|---|
| `angels init [--auto\|--manual]` | Bootstrap `.angels/` in current project. Walks the tree, identifies significant folders, creates angel.md drafts. |
| `angels onboard [--angel <id>] [--force] [--auto-activate] [--target-pct <n>] [--max-tokens <n>] [--parallel <n>]` | Bootstrap angel context from existing codebase (runs DISCOVERY phase). `--target-pct` overrides `memory.target_pct` (1-100); `--max-tokens` overrides `memory.max_tokens`; `--parallel` onboards up to N angels concurrently (1-8, default 4). |
| `angels activate [<angel-id>] [--all]` | Promote draft angels to active after reviewing. |
| `angels list` | List all registered angels with their status. |
| `angels create <path>` | Create an angel for a specific folder. |
| `angels brief <angel-id> "<task>"` | Phase 1: send a review brief to an angel. Does NOT execute. |
| `angels execute <angel-id> <brief-path> [--no-strict-territory]` | Phase 2: re-invoke angel with approval to execute changes. Out-of-territory writes are blocked and rolled back by default; `--no-strict-territory` downgrades them to warnings. |
| `angels do <angel-id> "<task>" [--no-strict-territory]` | Brief and execute in a single step. Aborts if angel raises concerns or refuses. |
| `angels cable <to> <type> "<body>"` | Send a cable (inter-angel message). Types: `breaking_change`, `fyi`, `review_request`, `invariant_violation`. |
| `angels inbox <angel-id>` | Show pending cables for an angel. |
| `angels newspaper [--since=<iso>]` | Print newspaper entries (append-only log). Records cable, brief, execute, and sweep events. |
| `angels sweep [--since=<iso>] [--timeout=<seconds>] [--parallel <n>]` | Wake every angel in maintenance mode. `--timeout` caps each angel invocation; `--parallel` sweeps up to N angels concurrently (1-8, default 4). Also rotates an oversized newspaper and archives old briefs/responses before starting. Report-only in v1. |
| `angels doctor [--archive] [--older-than=N]` | Health check: orphaned angels, missing angels, stale locks, stale drafts. `--archive` moves old files to `_archive/`. |
| `angels retire <angel-id>` | Archive and remove an angel from the project. |
| `angels ask <angel-id> "<question>"` | Ask an angel a read-only question (no brief file, no execute path). |
| `angels chat <angel-id> "<message>"` | Append a note to the angel's chat history (no invocation). |
| `angels show <angel-id>` | Print the current `angel.md` for an angel. |
| `angels completion <shell>` | Print a shell completion script. Supported shells: `bash`, `zsh`. |

## Response format

Angels answer with a **structured JSON file** (since 0.3.0; validated against a strict schema, so malformed or invented fields fail loudly instead of being half-parsed). A response looks like:

```json
{
  "format_version": 1,
  "from": "src-auth",
  "timestamp": "2026-05-12T14:32:00Z",
  "verdict": "proceed",
  "proposed_plan": "1. Add a token-bucket middleware in src/auth/rateLimit.ts\n2. Wire it into the login route",
  "questions_for_main": "Should the limit be configurable per tenant?",
  "cables_sent": [{ "to": "src-api", "type": "fyi" }],
  "files_changed": ["src/auth/rateLimit.ts", "src/auth/login.ts"],
  "angel_md_updated": true
}
```

`angels brief` prints the brief path and a human-readable summary of that response:

```
Brief written to: .angels/_briefs/src-auth/2026-05-12T1432-0001.md

=== Angel Response: PROCEED ===

PROPOSED PLAN:
  1. Add a token-bucket middleware in src/auth/rateLimit.ts
  2. Wire it into the login route

QUESTIONS FOR MAIN:
  Should the limit be configurable per tenant?

Response file: .angels/_responses/src-auth/2026-05-12T1432-0001.json
```

Possible verdicts: `PROCEED` (exit 0), `CONCERNS` (exit 2), `REFUSE` (exit 3). When the angel raises concerns the response includes its concerns and a proposed plan; when it refuses it cites the violated invariant IDs (see [Invariant IDs](#invariant-ids)).

`angels execute` prints the execution result, runs the territory's [proof-of-done checks](#proof-of-done-checks), and reports:

```
Execute brief written to: .angels/_briefs/src-auth/2026-05-12T1433-0001.md

Running 1 proof-of-done check(s)...
  PASS  tests: npm test
  Check output: .angels/_logs/src-auth/2026-05-12T14-33-00.000Z-checks.log

=== Execute Result: DONE ===

FILES CHANGED:
  src/auth/rateLimit.ts, src/auth/login.ts

angel.md was updated.

CABLES SENT:
  src-api: fyi

Response file: .angels/_responses/src-auth/2026-05-12T1433-0001.json
```

**Territory enforcement is strict by default**: if the angel wrote files outside its territory, new files are deleted (rolled back), the execute fails with exit 1, and the violation is recorded in the newspaper. Pass `--no-strict-territory` (or set `execute.strict_territory: false` in `_config.yml`) to downgrade violations to warnings.

## Proof-of-done checks

An EXECUTE only counts as done when the territory's configured checks pass. Checks are shell commands run by the orchestrator (never by the angel) after the angel reports done; their output is stored under `.angels/_logs/` as evidence.

```yaml
angels:
  - id: src-auth
    type: folder
    path: src/auth
    checks:
      - name: tests
        cmd: "npm test"
      - name: lint
        cmd: "npx eslint src/auth --quiet"
checks_timeout_seconds: 300   # per-check timeout (default 300)
```

If any check fails, `angels execute` exits 1, prints the failing output, and the newspaper records `EXECUTE failed proof-of-done checks`. Changes are NOT rolled back — the evidence tells you what to fix.

## Invariant IDs

Invariants in `angel.md` carry stable IDs (`INV-001`, `INV-002`, ...). IDs are never reused; when an angel refuses a brief it cites the violated IDs, which makes refusals auditable in the newspaper and response files.

## Angel memory system

The DISCOVERY phase builds a persistent `angel.md` file per angel. Three mechanisms control how large and detailed these memory files become:

### Deep context reading

DISCOVERY reads priority files from each angel's territory (READMEs, entry points, type definitions, tests, and config files) and passes them inline to the angel. The old pipeline was limited to 50 KB / 10 files; the enhanced pipeline classifies files by value (`high` / `medium` / `low`), reads high-value files in full (with boilerplate filtering), and dynamically allocates context budget.

### Direct write

When the memory target is ambitious (`memory.target_pct > 5%`), the angel writes `angel.md` **directly** to disk instead of embedding it inside the `proposed_plan` field of the response JSON. This eliminates the response-file throughput bottleneck and allows much larger outputs. The orchestrator verifies the file was written and updates frontmatter after the invocation completes.

### Chunked writing

If the estimated `angel.md` body exceeds **50 KB**, the pipeline splits generation into **chunks** of ~50K tokens each, generated in separate backend invocations. Each chunk appends to the same `angel.md` file (via `appendAngelMd`). Sections are pre-assigned to chunks so the angel knows what to cover in each invocation:

| Chunk | Sections |
|-------|----------|
| 1 | Charter & Boundaries, Architecture |
| 2 | Public Contract, Invariants |
| 3 | Code Coverage (files 1–10) |
| 4 | Code Coverage (files 11+) + Data Model |
| 5 | Critical Flows, Testing Patterns, Decision Log, Debt, Dependencies |

### Configuration

Add a `memory` key to `.angels/_config.yml`:

```yaml
memory:
  target_pct: 25           # % of context window to use (1–100, default 25)
  # max_tokens: 250000     # absolute token budget; overrides target_pct
```

- `target_pct`: percentage of the estimated context window (default: 25%). At `≤ 5%`, direct write is disabled and the body travels in the `proposed_plan` response field.
- `max_tokens`: absolute token budget. Takes priority over `target_pct` when both are set.

Per-angel overrides are also supported:

```yaml
angels:
  - id: src-api
    type: folder
    path: src/api
    memory:
      max_tokens: 200000   # override for this angel only
```

## Backend configuration

Guard Angels is backend-agnostic. Configure the AI CLI used to invoke angels in `.angels/_config.yml`:

```yaml
version: 1
backend:
  angel_cmd: "claude -p --dangerously-skip-permissions"  # default
  angel_timeout_seconds: 600                              # 10 min default
angels:
  - id: _root
    type: root
    path: "."
  - id: src-auth
    type: folder
    path: "src/auth"
    checks:                        # optional proof-of-done checks
      - name: tests
        cmd: "npm test"
sweep:
  autonomy: report-only   # v1 always report-only
execute:
  strict_territory: true  # default: block + roll back out-of-territory writes
checks_timeout_seconds: 300        # per-check timeout (default 300)
newspaper:
  max_bytes: 5242880      # rotate the newspaper beyond this size (default 5 MB)
housekeeping:
  archive_after_days: 30  # sweep/doctor archive briefs/responses older than this
```

Supported backends (auto-detected from the first token of `angel_cmd`):

| Backend | Command example | Notes |
|---|---|---|
| Claude Code | `claude -p --dangerously-skip-permissions` | Default. Guard Angels appends `--output-format json` and reads session ID, token usage, and cost from the JSON envelope into `.meta.json`. |
| Codex | `codex exec` | Extracts thread ID. |
| Droid | `droid exec` | No session ID extraction. |
| Generic | any command | Fallback. Pipes prompt via stdin. |

## File layout

```
.angels/
├── .gitignore           # Auto-created by init; excludes ephemeral dirs
├── _config.yml          # Project configuration
├── _newspaper.md        # Append-only event log (current generation)
├── _newspaper.generation # Rotation counter for the newspaper
├── _briefs/             # Outgoing briefs (main → angels)
│   └── <angel-id>/
├── _responses/          # Responses (angels → main, JSON)
│   └── <angel-id>/
├── _inbox/              # Cables awaiting angel processing
│   └── <angel-id>/
├── _outbox/             # Cables sent (audit trail)
├── _locks/              # Per-angel locks during invocations
├── _logs/               # Raw stdout/stderr + check evidence per invocation
├── _cursors/            # Per-angel newspaper cursor (generation + byte offset)
├── _archive/            # Archived old files (by month) + rotated newspapers
│   └── newspaper/
├── _root/               # Root angel
│   └── angel.md
└── src/
    ├── auth/
    │   └── angel.md
    └── api/
        └── angel.md
```

Angel IDs mirror the folder path: `/` → `-`, literal `-` in a segment name → `--`. So `src/auth` → `src-auth`, `src/my-component` → `src-my--component`. The root angel is `_root`.

## Global flags

| Flag | Description |
|---|---|
| `--verbose` | Enable stack traces and full error chain on errors. Without this flag, only the top-level error message is shown. |

## Exit codes

Every command returns a meaningful exit code:

| Command | Code | Meaning |
|---|---|---|
| `init` | 0 | Initialization completed |
| | 1 | Error (already initialized, invalid flags, filesystem error) |
| `onboard` | 0 | All targeted angels onboarded |
| | 1 | Error (not initialized, backend failure, invalid flags) |
| `activate` | 0 | Angel(s) activated |
| | 1 | Error (not initialized, angel not found, no target specified) |
| `list` | 0 | Listed successfully |
| | 1 | Error (project not initialized) |
| `create` | 0 | Angel created |
| | 1 | Error (duplicate, path outside root, folder not found, not initialized) |
| `brief` | 0 | Angel responds: proceed |
| | 1 | Error (angel error, timeout, invocation failure) |
| | 2 | Angel responds: concerns |
| | 3 | Angel responds: refuse |
| `do` | 0 | Brief succeeded (proceed) and execute succeeded (done) |
| | 1 | Error during review or execute |
| | 2 | Angel responded with concerns |
| | 3 | Angel refused |
| `execute` | 0 | Angel responds: done (and all proof-of-done checks passed) |
| | 1 | Error, non-done response, failed checks, or blocked by strict territory |
| `cable` | 0 | Cable sent |
| | 1 | Error (invalid type, urgency, unknown angel) |
| `inbox` | 0 | Inbox displayed |
| | 1 | Error (unknown angel, not initialized) |
| `newspaper` | 0 | Entries displayed |
| | 1 | Error (not initialized, invalid --since) |
| `sweep` | 0 | All angels swept without errors |
| | 1 | At least one angel reported an error |
| `doctor` | 0 | No issues found |
| | 1 | Issues found or error |

## Error handling

Guard Angels follows a fail-loud philosophy: errors are descriptive and name the offending file, field, or path. There are no silent fallbacks, no swallowed exceptions, and no placeholder data. If something fails, you get a clear error message pointing at the root cause.

Use `--verbose` to see full stack traces and error cause chains for debugging.

## Main-agent prompt addendum

Add this to your project's `CLAUDE.md` (or equivalent) so the main agent knows how to use Guard Angels:

```
This project uses Guard Angels. Significant folders have angels that own
their territory. Manual edits inside an angel's territory are FORBIDDEN.
They leave angel.md stale, skip cable emission, and break the audit trail
(newspaper, FILES CHANGED record).

Before editing any code:

1. Check `angels list` to see which folders have angels.
2. For changes inside an angel's folder: do NOT edit directly. Use
   `angels brief <angel-id> "<task>"` to delegate. Review the response.
   If the angel proceeds, run `angels execute <angel-id> <brief-path>`.
   If the angel raises concerns, address them before executing.
3. Even if the plan seems deterministic or mechanical, you MUST use
   `angels execute`. The angel's role is not just review - it also writes
   its own memory updates. Bypassing execute corrupts the project's
   institutional knowledge.
4. For changes spanning multiple folders: brief each affected angel
   sequentially.
5. After a batch of changes: run `angels sweep`.
6. Read `angels newspaper` regularly.

The angel.md files in `.angels/` are authoritative documentation. Read them
before asking the user about folder-level decisions.
```

## Composing with Ralph

Guard Angels is designed to work inside a [Ralph](https://github.com/compota334/ralph)-style outer loop. In a Ralph setup, each iteration spawns a fresh AI agent with no memory of prior runs; continuity comes from files on disk. Guard Angels provides exactly that: per-folder memory (`angel.md`), a shared event log (`_newspaper.md`), and an inter-angel messaging system (cables). The Ralph outer agent delegates folder-level work to angels, and each angel invocation is itself a fresh-context, file-state Ralph invocation.

To use Guard Angels as the per-task delegate inside a Ralph loop, add this to your Ralph agent's prompt:

```
When implementing a task that touches code inside an angel's folder, manual
edits are FORBIDDEN. They leave angel.md stale, skip cable emission, and
break the audit trail (newspaper, FILES CHANGED record). Instead:
1. Run `angels brief <angel-id> "<task description>"` to get the angel's review.
2. If the angel responds with "proceed", you MUST run
   `angels execute <angel-id> <brief-path>`. Even if the plan looks mechanical,
   bypass is FORBIDDEN - the angel also writes its own memory updates.
3. If the angel raises concerns, address them before executing.
4. After all changes, run `angels sweep` to let angels update their memory.
5. Check `angels newspaper` for any cross-cutting issues flagged by angels.
```

## License

[MIT](LICENSE.md)
