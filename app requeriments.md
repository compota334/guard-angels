# Guard Angels — Build Specification

This is the source of truth for the Guard Angels project. Read it before every task.

---

## 1. The problem

Current AI coding tools lose context. They forget why files exist, what decisions were made, what invariants must hold, and what depends on what. As codebases grow, this manifests as redundant code, broken contracts, accidental architectural violations, and silent regressions.

Guard Angels solves this by giving each significant folder in a project its own persistent "angel" — a per-folder LLM agent that owns the *why* of that folder, executes changes within its territory, and coordinates with other angels.

## 2. The architecture in one paragraph

The user interacts with their normal AI coding CLI (Claude Code, Codex, Windsurf, etc.) — call this the "main agent." The main agent is augmented with a CLI tool (`angels`) that lets it create, brief, and consult folder-level angels. Each angel is a fresh sub-process invocation of an AI coding CLI, given a system prompt built from the angel's persistent memory file (`angel.md`) plus a task brief. Angels are the only ones allowed to edit code inside their folder; the main agent must delegate. Angels can push back before executing a change. State lives entirely on disk — angel memory, briefs, responses, cables (urgent inter-angel messages), and a global newspaper (append-only event log). This is "Ralph-recursive": the user's loop is Ralph-style, and inside it, each angel call is also a fresh-context, file-state Ralph invocation.

## 3. Locked-in design decisions

These are not up for debate; build to these:

1. **Folder-level angels only in v1.** No per-file angels yet.
2. **Angels execute edits within their folder.** Main agent delegates, never edits inside angel territory directly.
3. **Two-phase protocol.** Every change request: phase 1 angel reviews and may raise concerns; phase 2 angel executes after approval.
4. **Sequential execution.** Main agent invokes angels one at a time. No parallelism in v1.
5. **Backend-agnostic via env var.** The CLI used to invoke angels is configurable: `claude -p`, `codex exec`, `droid exec`, etc. Default to Claude Code.
6. **All state on disk, all in `.angels/`.** Committed to git. Survives without the tool installed.
7. **Mirror folder structure.** `.angels/<path-mirroring-project>/angel.md`.
8. **Root angel** owns shared-territory files (package.json, tsconfig.json, README, CI configs, etc.) AND any folder not claimed by a more-specific angel. Most-specific-angel-wins for nested folders.
9. **Sweep mode is report-only in v1.** Angels flag drift; humans/main agent decide what to fix.
10. **Testing is judgment-based, not gated.** Angels are instructed to use common sense about writing/running tests in light of the change. No hard test gates that block commits in v1.

## 4. Tech stack

- **Node.js (v20+)**, TypeScript, distributed via npm as `@guard-angels/cli`
- Single binary entrypoint: `angels`
- No database. Plain files only. YAML for config, Markdown for everything human-readable.
- Use `execa` or `child_process` for invoking backend CLIs.
- Use `commander` for CLI parsing.
- `vitest` for tests. `zod` for config validation. `yaml` for parsing `_config.yml`.
- Keep dependencies minimal.

## 5. Directory layout in a user's project

```
project-root/
├── src/
│   ├── auth/
│   │   ├── session.ts
│   │   └── middleware.ts
│   └── api/
│       └── routes.ts
├── package.json
└── .angels/
    ├── _config.yml
    ├── _newspaper.md
    ├── _briefs/                   # outgoing briefs from main → angels
    │   └── <angel-id>/
    │       └── 2026-04-28T1432-001.md
    ├── _responses/                # responses from angels → main
    │   └── <angel-id>/
    │       └── 2026-04-28T1432-001.md
    ├── _inbox/                    # cables awaiting angel processing
    │   └── <angel-id>/
    │       └── 2026-04-28T1500-cable-from-auth.md
    ├── _outbox/                   # cables sent (audit trail)
    ├── _locks/                    # active file locks during execution
    ├── _logs/                     # raw stdout/stderr from each angel invocation
    ├── _cursors/                  # per-angel last-seen newspaper offset
    ├── _archive/                  # archived briefs/responses/logs (older than threshold)
    ├── _root/                     # the root angel
    │   └── angel.md
    └── src/
        ├── auth/
        │   └── angel.md
        └── api/
            └── angel.md
```

Angel ID convention: the path of the angel's directory under `.angels/`, with `/` replaced by `-`. So `.angels/src/auth/angel.md` belongs to angel `src-auth`. The root angel is `_root`.

## 6. File formats

### 6.1 `_config.yml`

```yaml
version: 1
backend:
  main_agent_cmd: "claude -p --dangerously-skip-permissions"   # informational
  angel_cmd: "claude -p --dangerously-skip-permissions"
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: "."
  - id: src-auth
    type: folder
    path: "src/auth"
  - id: src-api
    type: folder
    path: "src/api"
sweep:
  autonomy: report-only       # v1 always report-only
```

### 6.2 `angel.md` (the heart of the system)

`angel.md` has YAML frontmatter for machine-readable lifecycle metadata, then the spec's markdown body. Every `angel.md` follows this template:

```markdown
---
status: active            # draft | active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main     # main | sweep | self
---

# Angel: <path> (<type>)

## Charter
What this folder owns. What it does NOT own (with pointers to who does).

## Public contract
What this folder exposes to the rest of the codebase. The names, types, and
guarantees that other folders rely on.

## Invariants
Rules that must never be violated. Bullet list. Each invariant is short and
testable in principle.

## Decision log
Append-only. Each entry: date, decision, reason, alternatives rejected.

## Open questions / known debt
Bullets. What's unresolved, what's deferred.

## Dependencies
- Angels this folder depends on (and why)
- Angels that depend on this folder (and what they rely on)
```

Newly-generated drafts have `status: draft` until a human (or a subsequent EXECUTE) edits and flips it to `active`. The "Last updated" data lives in frontmatter, not the body, so machines can update it without rewriting prose.

### 6.3 Brief format (`_briefs/<angel-id>/<timestamp>-<seq>.md`)

```markdown
TO: <angel-id>
FROM: main
TIMESTAMP: <iso>
PHASE: review        # or "execute"
TYPE: change_request # or "consultation", "sweep"

TASK:
<plain language task description>

CONTEXT:
<why this is needed, links to user request>

EXPECTED SCOPE:
<best guess at which files will change>

PRIOR RESPONSE: <path or "none">  # for phase 2, points to phase 1 response
```

Sequence numbering: orchestrator scans existing same-day files in the target dir and picks `max(seq)+1`, zero-padded to 3 digits.

### 6.4 Response format (`_responses/<angel-id>/<timestamp>-<seq>.md`)

```markdown
FROM: <angel-id>
TIMESTAMP: <iso>
RESPONSE: <one of: proceed, concerns, refuse, done, error>

CONCERNS:
- <each concern>

PROPOSED PLAN:
1. <step>
2. <step>

QUESTIONS FOR MAIN:
- <each question>

PROCEED IF:
<conditions that would resolve concerns>

TEST_RESULTS:
<optional: command + outcome lines, only if tests were run>

CABLES SENT: <list of cable file paths, only on "done">
FILES CHANGED: <list of file paths, only on "done">
ANGEL_MD_UPDATED: <true|false, only on "done">
```

### 6.5 Cable format (`_inbox/<target-angel>/<timestamp>-<short-name>.md`)

```markdown
FROM: <angel-id>
TO: <angel-id>
TIMESTAMP: <iso>
TYPE: <breaking_change | fyi | review_request | invariant_violation>
URGENCY: <high | normal | low>
SUBJECT: <one line>
REQUIRES_ACK: <true | false>

BODY:
<message>

REFERENCES:
- <file paths, line numbers, or commit hashes>
```

### 6.6 Newspaper entry (appended to `_newspaper.md`)

```markdown
## <iso-timestamp> [<angel-id>]
<one-line summary>
<optional details, kept short>
<links to relevant briefs/responses>
```

The newspaper is event-log-only — it does not have a hoisted "Patterns" section. Project-wide patterns belong in the root angel's `angel.md`.

### 6.7 Per-angel cursor (`_cursors/<angel-id>`)

A single-line file containing either the byte offset or last-consumed entry timestamp from `_newspaper.md`. The orchestrator advances it after each successful angel invocation.

## 7. CLI commands

The `angels` CLI is the orchestrator. It does NOT call LLMs directly except by spawning the configured backend CLI as a subprocess.

```
angels init                          Bootstrap .angels/ in current project.
                                     Walks the tree, identifies significant
                                     folders, runs an angel-init pass for each.
                                     Interactive by default. --auto accepts
                                     all heuristic candidates. --manual skips
                                     heuristics entirely.

angels list                          List all registered angels.

angels create <path>                 Create an angel for a specific folder.
                                     Spawns an init sub-process.

angels brief <angel-id> <task>       Phase 1 of the protocol. Writes a brief,
                                     invokes the angel in review mode, prints
                                     the response. Does NOT execute.

angels execute <angel-id> <brief>    Phase 2. Re-invokes the angel with the
                                     prior brief + approval, in execute mode.

angels cable <to> <type> <body>      Manually send a cable.

angels inbox <angel-id>              Show pending cables for an angel.

angels newspaper [--since=<iso>]     Print recent newspaper entries.

angels sweep [--since=<commit>]      Wake every angel in maintenance mode.
                                     Each reads its inbox, the newspaper delta,
                                     and its folder; reports drift; updates
                                     its own angel.md if needed; sends cables.
                                     v1 is report-only. --since accepts a git
                                     commit OR an ISO timestamp (git optional).

angels doctor [--archive]            Sanity check: orphaned angels, missing
                                     angels for new folders, stale locks.
                                     --archive moves briefs/responses/logs
                                     older than --older-than=<days, default 30>
                                     into .angels/_archive/<YYYY-MM>/.
```

The main agent (Claude Code, etc.) calls these as shell commands. That's the entire integration surface. No forks, no plugins.

## 8. The angel system prompt template

When the orchestrator invokes a backend CLI to act as an angel, it constructs a prompt by concatenating these pieces in order:

```
[FIXED PROTOCOL HEADER]
You are a Guard Angel. You are responsible for one specific folder of a codebase.
You operate under the following protocol:

1. You may READ any file in the project for context. You may only WRITE files
   inside your designated folder.
2. You operate in one of two phases: REVIEW or EXECUTE. The current phase is
   stated in the brief.
3. In REVIEW, you must NOT modify any code. You read the brief, your charter,
   the relevant code, and respond with concerns or "proceed".
4. In EXECUTE, you make the requested changes, update your angel.md, send
   cables to affected angels, and append a newspaper entry.
5. Your final action in either phase is to write a structured response file at
   the path specified.
6. You may write/update tests using your judgment about what's appropriate for
   the change. There is no rule requiring tests, but use common sense — if
   you're changing logic, consider whether tests should change too. If you run
   tests, report the results in your response.
7. If the brief asks for something that violates an invariant in your
   angel.md, surface the concern in REVIEW. Do not silently comply.

[ANGEL IDENTITY]
You are the angel for: <path>
Your angel ID is: <id>
Your folder contents: <ls of the folder>

[YOUR MEMORY]
<contents of angel.md (frontmatter + body)>

[NEWSPAPER DELTA SINCE YOUR LAST ACTIVATION]
<entries since last cursor position>

[YOUR INBOX]
<list of pending cables, full content of urgent ones>

[BRIEF]
<contents of brief file>

[OUTPUT INSTRUCTIONS]
Write your response to: <response file path>
Use the response format documented at <doc path>.
When done, exit. Do not loop or wait for input.
```

The prompt builder produces four phase variants: `init`, `review`, `execute`, `sweep`. Each swaps a phase-specific instructions block; the rest is shared.

## 9. The main agent prompt addendum

When a user installs Guard Angels, they add this to their project's `CLAUDE.md` (or equivalent):

```
This project uses Guard Angels. Significant folders have angels that own
their territory. Before editing code, check `angels list` and:

1. For changes inside an angel's folder: do NOT edit directly. Use
   `angels brief <angel-id> "<task>"` to delegate. Review the response.
   If the angel proceeds, run `angels execute <angel-id> <brief-path>`.
2. For changes spanning multiple folders: brief each affected angel
   sequentially. Coordinate based on their responses.
3. For changes to root files (package.json, configs): brief the _root angel.
4. After a batch of changes: run `angels sweep` to let angels update their
   memory and flag drift.
5. Read `angels newspaper --since=<last-check>` periodically to stay current.

The angel.md files in `.angels/` are authoritative documentation. If you
need to understand why something exists, read the relevant angel.md before
asking the user.
```

## 10. Backend adapter contract

Backend adapters abstract the CLI used to invoke angels. The orchestrator picks an adapter by parsing the first token of `backend.angel_cmd`.

```ts
interface BackendAdapter {
  name: string                                  // "claude" | "codex" | "droid" | "generic"
  invoke(opts: {
    prompt: string
    cwd: string
    timeoutMs: number
    extraArgs?: string[]
  }): Promise<{
    stdout: string
    stderr: string
    code: number
    sessionId?: string                          // best-effort
  }>
  extractSessionId?(stdout: string): string | null
}
```

Built-in adapters:
- `claude` — pipes prompt via stdin, captures session ID if present.
- `codex` — `codex exec`, captures thread ID.
- `droid` — `droid exec`, no session ID.
- `generic` — fallback for any other command; pipes prompt via stdin, no session ID.

## 11. Init ingestion of existing memory files

When `angels init` (or `angels create <path>`) generates a draft `angel.md` for a folder, it first checks for existing memory files in that folder:

- `<path>/AGENTS.md` (Ralph convention)
- `<path>/CLAUDE.md` (only for non-root folders; the project-root `CLAUDE.md` is the user's main-agent instructions, not a per-folder memory file)

If found, the backend CLI is given the file contents and asked to seed the new `angel.md`'s Charter / Public contract / Patterns sections from it. The original files stay untouched. This makes Guard Angels a clean upgrade path for projects already using AGENTS.md.

## 12. Implementation milestones

Build in this order. Do not jump ahead.

**Milestone 1 — Skeleton.** Project scaffold, TypeScript build, CLI entrypoint with all command stubs printing "not implemented." Config loading. Angel ID resolution. Path utilities.

**Milestone 2 — Init and create.** `angels init` walks the tree, prompts user (or auto-detects) which folders are "significant" — heuristics: has at least 3 source files, has a non-generic name, or contains an index/main file. Ingests existing AGENTS.md/CLAUDE.md. Creates angel.md drafts using the configured backend CLI. Each draft has `status: draft` in frontmatter until edited.

**Milestone 3 — Brief and execute (the protocol).** Implement the two-phase invocation. Construct the angel system prompt. Spawn the backend CLI. Capture stdout/stderr to logs (and meta.json with session ID when extractable). Parse the response file. Print a clean summary to the user. Phase 2 with approval flow. Lock acquisition and TTL release.

**Milestone 4 — Newspaper and cables.** Append-only newspaper. Per-angel cursors. Inbox/outbox. Angels read inbox at start of every invocation. Cables generated during EXECUTE are written to outbox and copied to target inbox.

**Milestone 5 — Sweep.** `angels sweep` iterates angels, invokes each in maintenance mode, collects reports, prints summary. Report-only.

**Milestone 6 — Doctor and polish.** `angels doctor` checks for orphaned angels, folders without angels, stale locks. `--archive` flag implements the archive policy. README. Improve error messages.

Stop after milestone 6. Do not build: parallel execution, file-level angels, autonomous fix mode, supervisor angels, web UI. These are v2.

## 13. Testing philosophy for the tool itself

Write integration tests for the orchestrator using a fake backend CLI (a shell script that writes canned response files based on the brief). Test the full protocol end-to-end without burning real LLM calls. Unit-test the file format parsers. Aim for meaningful coverage of the protocol logic, not 100%.

## 14. Cost and safety guardrails

- Hard timeout per angel invocation (default 10 min, configurable via `angel_timeout_seconds`).
- Max concurrent angels = 1 in v1 (sequential). Enforced by a single global lock at `.angels/_locks/orchestrator.lock` (PID + start time, TTL = `angel_timeout_seconds + 30s`).
- Print estimated cost or token usage if the backend CLI reports it.
- All angel invocations get logged to `.angels/_logs/<angel-id>/<timestamp>.{log,meta.json}` with brief/response references for post-hoc debugging.
- Locks have a TTL; `angels doctor` clears stale ones.
- After EXECUTE, orchestrator captures git status before/after (or folder-tree snapshot if no git) and warns on writes outside the angel's territory. v1: warn only, not enforce.

## 15. Error handling philosophy

Per the project's general code style: prefer visible failure over silent fallback. If a primary path fails, throw a clear error. No defensive shims, no backwards-compat hacks, no fake data, no swallowed exceptions. Validate at system boundaries (config parsing, response parsing, backend invocation results); trust internal code.

## 16. Things explicitly NOT in scope

- Do not invent a new agent framework. We use the user's existing CLI as the agent. We are an orchestrator.
- Do not put angels in a database. Files only.
- Do not make angels invoke each other directly. All coordination goes through the main agent in v1.
- Do not add a web UI, dashboard, or service. CLI only.
- Do not auto-fix anything in sweep mode. Report only.
- Do not add per-file angels. Folder only.
- Do not parallelize. Sequential only.
- Do not push to a remote, send notifications, or post to external services from the orchestrator. It is offline.
