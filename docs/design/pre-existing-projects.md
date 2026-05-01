# Design: Guard Angel Support for Pre-Existing Projects

**Date:** 2026-05-02
**Status:** Proposal — open for review

---

## Problem Statement

Guard Angel's `init` command was designed for greenfield projects: it detects candidate folders and writes blank `angel.md` templates. Three real-world scenarios expose gaps:

1. **Clone and adopt** — user clones a mature GitHub repo and wants Guard Angel supervision immediately.
2. **Mid-project adoption** — user adds Guard Angel to a project that already has substantial code, docs, and conventions.
3. **Branch-aware context** — user works across git branches where folder structure and concerns differ; angels carry stale context from a different branch.

In all three cases, angels start with zero domain knowledge. The first `sweep` produces generic reports. The user must manually fill in every `angel.md` — the exact work Guard Angel is supposed to automate.

---

## Perspective 1: UX Designer

### Current pain point

The `init` flow asks the user to select folders then creates empty templates with comment placeholders. For a project with 50,000 lines of code, this produces 8–12 angel.md files that each say:

```markdown
## Charter
<!-- What this folder owns. -->
```

The user stares at blank files and has to do the knowledge-extraction work by hand.

### Ideal user journey

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

### Command naming recommendation

`angels onboard` — a separate subcommand, not a flag on `init`.

**Rationale:**

| Option | Verdict |
|--------|---------|
| `angels init --onboard` | Confusing: init creates structure; onboarding is a different concern |
| `angels init --existing` | Misleading: init still runs discovery; the distinction is unclear |
| `angels onboard` | Semantically clear, discoverable in `--help`, composable with `--angel` |

`init` should detect that the project has existing code and print a one-line tip suggesting `onboard`. It does not run discovery itself.

### Draft status as a review gate

Angels produced by `onboard` start as `status: draft`. Draft angels:

- Appear in `angels list` (marked with a "draft" badge)
- Are excluded from `sweep` by default (so garbage context does not pollute the newspaper)
- Become active via `angels activate <id>` or `angels activate --all`

This gives the user a natural review moment before angels start influencing decisions.

---

## Perspective 2: Architect

### Separation of concerns

Current `init` conflates two jobs:

1. Create `.angels/` directory structure
2. Draft `angel.md` (attempts to read `AGENTS.md`/`CLAUDE.md` as seed)

For existing projects a third job is needed:

3. Discover and internalize existing project knowledge

Proposed clean boundary:

```
angels init      → structure only + blank templates (fast, no AI unless seed file found)
angels onboard   → structure + DISCOVERY phase per angel (AI-heavy, reads code)
angels create    → adds one angel to an existing project (no DISCOVERY by default)
```

`onboard` can be run:
- Fresh, on a project with no `.angels/` yet (combines `init` and DISCOVERY)
- On a project that already has `.angels/` (re-onboard all or specific angels after a big refactor)

### DISCOVERY as a first-class protocol phase

The current protocol has four phases: INIT, REVIEW, EXECUTE, SWEEP.

Proposal: add **DISCOVERY** as a fifth phase.

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

### Context sources for bootstrapping (ranked by signal density)

| Priority | Source | Rationale |
|----------|---------|-----------|
| 1 | `{folder}/README.md` | Human-written intent; highest density |
| 2 | Entry points (`index.*`, `mod.*`, `__init__.*`, `main.*`) | Public surface |
| 3 | Type definitions (`*.d.ts`, `types.*`, `interfaces.*`) | Contracts |
| 4 | Test files (`*.test.*`, `*.spec.*`) | Behavioral specification |
| 5 | Config files (`package.json`, `pyproject.toml`) | Dependencies and scripts |
| 6 | All other source files | Complete picture |

The orchestrator pre-reads priority files and includes their content in the DISCOVERY prompt. The angel is given the full recursive file listing and the pre-read content; it synthesizes the `angel.md` body from what it has and requests more if needed (via the response format).

**Token budget guidance in the prompt:** include a directive like "Prioritize breadth over depth; name real artifacts you can see, mark anything uncertain with a specific question rather than a generic TODO."

### Idempotency and safety

- `onboard` on an angel with `status: active` prompts: `Angel src-auth already has active context. Overwrite? (y/N)` — default no.
- `onboard` on a `status: draft` angel overwrites silently (the user has not promoted it yet).
- A `--force` flag skips the prompt for automation contexts.
- Re-onboarding after a major refactor is a valid, supported workflow.

### Branch context strategy

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

---

## Perspective 3: Developer

### What changes and where

**New file: `src/commands/onboard.ts`**

Pseudocode sketch:

```typescript
export async function onboardAngels(opts: OnboardOptions): Promise<void> {
  const config = ensureInit(opts);          // create .angels/ if missing, else load
  const targets = selectAngels(config, opts.angel);

  for (const angel of targets) {
    if (isActive(angel) && !opts.force) {
      const confirmed = await promptOverwrite(angel.id);
      if (!confirmed) continue;
    }
    const context = buildDiscoveryContext(angel, opts.depth ?? 3);
    const result = await orchestrate(DISCOVERY, angel, context);
    writeAngelMd(angel, { status: 'draft', body: result.body });
    printSummary(angel.id, result);
  }
  printActivateHint();
}
```

**`src/protocol/prompt.ts` — add DISCOVERY case**

```typescript
case 'discovery':
  return `[PHASE INSTRUCTIONS - DISCOVERY]
You are reading an existing codebase to write your angel.md for the first time.

Rules:
- Read the file listing and pre-read files provided below.
- Write a complete angel.md body (no frontmatter — the orchestrator adds it).
- Name real functions, types, modules you can see. No generic placeholders.
- If you cannot determine something, leave a specific question in that section
  ("Q: Is the retry logic in processJob() bounded or unbounded?"),
  not a generic comment ("<!-- TODO -->").
- Do not modify any source files.`;
```

**`src/protocol/orchestrate.ts` — recursive listing for DISCOVERY**

Current listing (line 104) uses `fs.readdirSync()` — one level only. For DISCOVERY, provide a recursive listing with depth limit:

```typescript
function buildRecursiveListing(dir: string, depth: number): string {
  // Respects .gitignore via `git ls-files --others --cached` or a gitignore parser.
  // Returns relative paths, directories suffixed with '/'.
  // Truncates at configurable line limit (default: 500 lines).
}
```

Pre-read priority files and include them inline in the prompt section `[TERRITORY FILES]`. This removes the need for the angel to "request" reads — it gets the most important content upfront.

**`src/cli.ts` — register the new command**

```typescript
program
  .command('onboard')
  .description('bootstrap angel context from existing codebase')
  .option('--angel <id>', 'onboard only this angel')
  .option('--force', 'overwrite active angel.md without prompting')
  .option('--auto-activate', 'set status=active immediately (skip draft review)')
  .option('--depth <n>', 'recursion depth for file listing', '3')
  .action(wrapCommand(onboardAngels));

program
  .command('activate [angel-id]')
  .description('promote draft angel(s) to active')
  .option('--all', 'activate all draft angels')
  .action(wrapCommand(activateAngels));
```

**`src/commands/init.ts` — add tip for existing projects**

After candidate detection, before writing templates:

```typescript
const hasSubstantialCode = candidates.length > 0 &&
  candidates.some(c => c.reason.includes('source'));
if (hasSubstantialCode) {
  console.log('Tip: this looks like an existing project.');
  console.log('After init, run "angels onboard" to bootstrap context from your code.');
}
```

**`src/commands/init.ts` — auto-create `.angels/.gitignore`**

Add to the init flow alongside directory creation:

```typescript
fs.writeFileSync(
  path.join(angelsDir, '.gitignore'),
  [
    '# Generated per-run — do not track',
    '_briefs/',
    '_responses/',
    '_inbox/',
    '_outbox/',
    '_logs/',
    '_cursors/',
    '_locks/',
    '_archive/',
  ].join('\n') + '\n'
);
```

This ensures that angel.md files and `_config.yml` are tracked (persistent knowledge) while ephemeral data is ignored — correct default for both solo and team use.

### Implementation order

1. `src/commands/onboard.ts` — the new command shell
2. DISCOVERY phase in `src/protocol/prompt.ts`
3. Recursive listing in `src/protocol/orchestrate.ts`
4. `src/commands/init.ts` — `.gitignore` auto-creation and tip
5. `src/commands/activate.ts` — promote draft angels
6. `src/cli.ts` — register both new commands
7. Update `angels list` to show draft status
8. Tests: onboard on a fixture project with existing files

---

## Perspective 4: Project Maintainer

### Keeping angels accurate after the initial onboard

Onboarding is a one-time bootstrap. The harder problem is drift: code changes, angel.md does not.

**Current mechanism:** angels self-update their `angel.md` during EXECUTE. This works only if briefs flow regularly. Dormant angels drift.

**Proposal: drift detection in SWEEP.**

During sweep, the orchestrator compares `angel.md`'s `last_updated` timestamp against the newest `git log` modification date within that angel's folder. If the folder has commits newer than the last angel.md update by more than N days (configurable), the sweep prompt includes a `[DRIFT WARNING]` section:

```
[DRIFT WARNING]
Your territory has 47 commits since your last angel.md update (2026-03-10).
Recent changes: src/auth/jwt.ts, src/auth/session.ts (3 new files added).
Consider whether your Charter, Public contract, and Invariants are still accurate.
```

The angel can then update its `angel.md` as part of the sweep response — same mechanism as EXECUTE.

**Re-onboarding after major refactor:**

```bash
angels onboard --angel src-auth --force
```

This re-runs DISCOVERY on a single angel, overwriting its `angel.md` draft. The user promotes it after review.

### angel.md in version control

For team projects, angel.md files should be committed. The `.angels/.gitignore` described in the Developer section achieves the right split:

- **Tracked:** `_config.yml`, `*/angel.md`, `_newspaper.md`
- **Ignored:** `_briefs/`, `_responses/`, `_logs/`, `_cursors/`, `_locks/`, `_archive/`

This means:
- Angel context travels with the branch — teammates see the same angel knowledge
- Merging branches merges angel context, making divergence visible as git conflicts
- The newspaper and briefs are ephemeral (machine-generated per session) and should not be in history

### Long-term: `ONBOARD_REQUEST` cable type

An angel that detects substantial drift in its sweep could self-report with a structured cable to `_root`:

```
SUBJECT: onboard-request
BODY: Territory has changed significantly since last angel.md update. Requesting re-onboarding.
```

The `_root` angel (or a future `angels doctor` enhancement) could surface a list of pending onboard requests. This closes the loop: angels can signal when they need refreshed context, without requiring the user to track it manually.

---

## Proposed Command Surface (Summary)

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

1. **Token budget for DISCOVERY.** How many priority files should the orchestrator pre-read? A flat limit (e.g., 10 files × 200 lines) or a token budget managed by the orchestrator?

2. **gitignore parsing.** Should the recursive listing respect `.gitignore`? Shell out to `git ls-files` (requires git) or bundle a parser (adds dependency)?

3. **Activate gate.** Should draft angels participate in sweep at a reduced level (e.g., read-only sweep, no cable sending) rather than being fully excluded? This would let them produce reports before the user formally activates them.

4. **`angels onboard` on a greenfield project.** If `.angels/` does not exist yet, should `onboard` call `init` internally (combined flow) or require `init` first? Combined is better UX; separate is simpler code.

5. **Re-onboard diff.** For `--force` re-onboard on an active angel, should the command show a diff of what changed in `angel.md` before writing? Useful for large angel.md files where spotting what the AI changed matters.
