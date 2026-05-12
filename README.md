# Guard Angels

CLI orchestrator that gives each significant folder in your codebase its own persistent "angel" — a per-folder LLM agent that owns the *why* of that folder, executes changes within its territory, and coordinates with other angels via cables and a shared newspaper.

## Install

Guard Angels is not published to npm. Build from source:

```bash
cd /path/to/guard-angel   # wherever you placed the source
npm install
npm run build
npm install -g .
```

Requires Node.js >= 22.

## How it works

You keep using your normal AI coding CLI (Claude Code, Codex, etc.) as the "main agent." Guard Angels adds a delegation layer: instead of the main agent editing code directly, it *briefs* the relevant folder angel, reviews the angel's response, then tells it to *execute*. Each angel is a fresh subprocess of your configured AI CLI, given a system prompt built from the angel's persistent memory file (`angel.md`) plus the task brief.

All state lives on disk inside `.angels/`, committed to git. No database, no service, no web UI.

### Protocol phases

Angels operate in five phases:

1. **INIT** — `angels init` bootstraps `.angels/` and writes blank `angel.md` templates. For greenfield projects with no existing code.
2. **DISCOVERY** — `angels onboard` reads an existing codebase and synthesizes a real `angel.md` per angel. AI-heavy; priority files (READMEs, entry points, type definitions, tests) are pre-read and passed inline.
3. **REVIEW** — `angels brief <angel-id> "<task>"` sends the task to the angel. The angel reads its charter, the code, and the brief, then responds with `proceed`, `concerns`, or `refuse`. No files are modified.
4. **EXECUTE** — `angels execute <angel-id> <brief-path>` re-invokes the angel with approval. The angel makes the changes, updates its `angel.md`, sends cables to affected angels, and reports what it did.
5. **SWEEP** — `angels sweep` wakes every active angel in maintenance mode. Angels review their territory for drift and may send cables. Report-only in v1.

## Quickstart

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

# If the angel said "proceed", execute — pass the brief path printed above
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
| `angels onboard [--angel <id>] [--force] [--auto-activate]` | Bootstrap angel context from existing codebase (runs DISCOVERY phase). |
| `angels activate [<angel-id>] [--all]` | Promote draft angels to active after reviewing. |
| `angels list` | List all registered angels with their status. |
| `angels create <path>` | Create an angel for a specific folder. |
| `angels brief <angel-id> "<task>"` | Phase 1: send a review brief to an angel. Does NOT execute. |
| `angels execute <angel-id> <brief-path>` | Phase 2: re-invoke angel with approval to execute changes. |
| `angels do <angel-id> "<task>"` | Brief and execute in a single step. Aborts if angel raises concerns or refuses. |
| `angels cable <to> <type> "<body>"` | Send a cable (inter-angel message). Types: `breaking_change`, `fyi`, `review_request`, `invariant_violation`. |
| `angels inbox <angel-id>` | Show pending cables for an angel. |
| `angels newspaper [--since=<iso>]` | Print newspaper entries (append-only log). Records cable, brief, execute, and sweep events. |
| `angels sweep [--since=<iso>] [--timeout=<seconds>]` | Wake every angel in maintenance mode. `--timeout` caps each angel invocation; default from config. Report-only in v1. |
| `angels doctor [--archive] [--older-than=N]` | Health check: orphaned angels, missing angels, stale locks, stale drafts. `--archive` moves old files to `_archive/`. |

## Response format

`angels brief` prints the brief path, then the angel's structured response:

```
Brief written to: .angels/_briefs/src-auth/2026-05-12T1432-001.md

=== Angel Response: PROCEED ===

PROPOSED PLAN:
  1. Add a token-bucket middleware in src/auth/rateLimit.ts
  2. Wire it into the login route
  ...

QUESTIONS FOR MAIN:
  Should the limit be configurable per tenant?

Response file: .angels/_responses/src-auth/2026-05-12T1432-001.md
```

Possible verdicts: `PROCEED` (exit 0), `CONCERNS` (exit 1), `REFUSE` (exit 2). When the angel raises concerns the response includes a `CONCERNS` block; when it refuses it explains why in `CONCERNS`.

`angels execute` prints the execution result:

```
Execute brief written to: .angels/_briefs/src-auth/2026-05-12T1433-001.md

=== Execute Result: DONE ===

FILES CHANGED:
  src/auth/rateLimit.ts, src/auth/login.ts

angel.md was updated.

CABLES SENT:
  src-api: fyi

Response file: .angels/_responses/src-auth/2026-05-12T1433-001.md
```

If the angel wrote files outside its territory, a `WARNING: Out-of-territory writes detected` block appears and is also logged to the newspaper.

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
sweep:
  autonomy: report-only   # v1 always report-only
```

Supported backends (auto-detected from the first token of `angel_cmd`):

| Backend | Command example | Notes |
|---|---|---|
| Claude Code | `claude -p --dangerously-skip-permissions` | Default. Extracts session ID from stdout. |
| Codex | `codex exec` | Extracts thread ID. |
| Droid | `droid exec` | No session ID extraction. |
| Generic | any command | Fallback. Pipes prompt via stdin. |

## File layout

```
.angels/
├── .gitignore           # Auto-created by init; excludes ephemeral dirs
├── _config.yml          # Project configuration
├── _newspaper.md        # Append-only event log
├── _briefs/             # Outgoing briefs (main → angels)
│   └── <angel-id>/
├── _responses/          # Responses (angels → main)
│   └── <angel-id>/
├── _inbox/              # Cables awaiting angel processing
│   └── <angel-id>/
├── _outbox/             # Cables sent (audit trail)
├── _locks/              # Active lock during execution
├── _logs/               # Raw stdout/stderr per invocation
├── _cursors/            # Per-angel newspaper byte-offset
├── _archive/            # Archived old files (by month)
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
| | 1 | Angel responds: concerns |
| | 2 | Angel responds: refuse |
| | 3 | Error (angel error, timeout, invocation failure) |
| `do` | 0 | Brief succeeded (proceed) and execute succeeded (done) |
| | 1 | Angel responded with concerns or error during brief |
| | 2 | Angel refused during brief |
| | 3 | Execute phase failed after a successful brief |
| `execute` | 0 | Angel responds: done |
| | 1 | Error or non-done response |
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

Guard Angels is designed to work inside a [Ralph](https://github.com/compota334/ralph)-style outer loop. In a Ralph setup, each iteration spawns a fresh AI agent with no memory of prior runs — continuity comes from files on disk. Guard Angels provides exactly that: per-folder memory (`angel.md`), a shared event log (`_newspaper.md`), and an inter-angel messaging system (cables). The Ralph outer agent delegates folder-level work to angels, and each angel invocation is itself a fresh-context, file-state Ralph invocation.

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

Private. All rights reserved.
