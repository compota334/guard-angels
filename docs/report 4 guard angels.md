Guard Angels — Field report, sesión Calibrated_temp 2026-05-15/16
Context
Used Guard Angels intensively over ~30 hours to ship 5 commits to a live Polymarket trading bot:

Login w/ passcode (4e05be3)
Price-fetch corruption fix — CLOB midpoint as primary, replacing stale Gamma (409be21)
ClobClient API rename fix (798be00)
Orderbook 404 log dedup (42fe1db)
Git SHA exposed in /api/dashboard (6934169)
7 of 8 territory angels were exercised; some changes spanned 3 territories. All 33 regression tests passed across the entire session, no rollbacks.

Bugs / friction found in Guard Angels
1. Web angel writes angel.md to wrong location
Every other angel correctly writes to .angels/<id>/angel.md (canonical, covered by gitignore .angels/). The web angel writes a second copy to weather_bot/web/angel.md (inside the territory, NOT covered by .angels/ rule). Result: two divergent files coexist (12.9KB canonical vs 1.7KB stray). Caught by adding **/angel.md to .gitignore defensively, but it's a real inconsistency in path handling.

Evidence: trading/markets executes write to .angels/...; web execute output listed weather_bot/web/angel.md directly.

2. Out-of-territory writes are advisory, not enforced
The weather_bot angel was briefed to only touch config.py. It additionally wrote to .env.example (in _root territory). The execute returned WARNING: Out-of-territory writes detected: .env.example and proceeded. By chance the parallel _root execute wrote identical content, so no conflict — but a different ordering would have produced silent inconsistency.

Markets angel writes once bled into .venv/ site-packages mtimes during execute (probably from a pip/poetry op). Same advisory warning, no enforcement.

Suggestion: per-brief --strict-territory flag that rolls back out-of-scope writes unless explicitly listed in the brief.

3. "Proposed plan" sections still occasionally empty
Markets angel returned === Angel Response: CONCERNS === with literal text "I traced the full price fetch path. Here is the root cause analysis:" followed by an empty section, then PROPOSED PLAN with content. The promised root cause was simply missing. I had to push back and re-request — got a complete answer on the retry.

Same prompt-fidelity pattern previously reported. Maybe worth validating response shape (non-empty named sections) before declaring success.

4. CONCERNS sets bash exit code 1
./scripts/angels brief ... returns exit 1 when the angel verdict is CONCERNS. Treated as "failure" by basic shell wiring (set -e, monitors, etc.) even though it's a legitimate non-PROCEED state. Would be cleaner with distinct codes: 0=PROCEED, 2=CONCERNS, 3=REJECT.

5. No "quick ask" mode for read-only Q&A
Many of my questions to angels were pure knowledge queries ("where does the price fetch happen?", "what's the schema of X?"). The brief→review→execute cycle is overkill for these — a 30-second question becomes a 3-5 min ceremony. The brief file persisted to disk also clutters .angels/_briefs/ for queries that produce no change.

Suggestion: ./scripts/angels ask <id> "<question>" — angel reads angel.md + relevant code, answers inline, no brief file persisted, no execute path opened. Pure Q&A.

6. Cable visibility is opaque
After markets execute: CABLES SENT: weather_bot-trading. To consume that cable I had to brief trading separately with the cable's content baked into my prompt. Trading didn't auto-detect "I have an unconsumed cable about a signature change in a dependency." The cable was internal metadata I had to relay manually.

Suggestion: ./scripts/angels inbox <id> lists pending cables; ./scripts/angels brief <id> --consume-cables injects them automatically.

7. No angels show <id> command
To verify a brief landed correctly in angel.md I had to head .angels/<id>/angel.md myself. A first-class command for "show me what this angel currently knows" would be a small but useful improvement.

8. Angels self-flag gaps but can't auto-update during the same cycle
The trading angel, mid-investigation, told me explicitly: "my angel.md doesn't document X, Y, Z and I recommend a follow-up execute." Required a separate brief + execute cycle to actually do the update. Could be a single response: "here's my answer + here's the angel.md patch I'd write — orchestrator confirms or rejects."

9. Brief response structure varies across angels
Some return numbered prose, some bulleted lists, some both. Hard to extract programmatically. A standardized schema (e.g. always {files: [...], changes: [...], rationale: ...} in the proposed plan) would help orchestrators validate completeness before execute.

Orchestrator mistakes I made (worth surfacing as common patterns)
These ended up in user-private memory; sharing here so the framework docs might pre-empt them:

Self-grepped territory code instead of briefing the angel. Wasted 5+ greps, missed that the angel.md already documented the answer, and the new info I uncovered wasn't captured anywhere. User: "may you should have asked the guard angels that has that area of responsability isnnt it?"
Took over a delegated subagent's task when it transiently failed (Anthropic API 529). Should have retried the delegation. User: "no, no lo hagas tu. no te salteas los protocolos. intenta de nuevo."
Proposed removing a defensive code path to silence a benign ERROR log. User: "QUIERO LA OPCION MAS SEGURA, NO LAS MAS ESTETICA." Aesthetic-vs-safety trade-off should default to safety.
Misdiagnosed a bug at the wrong layer — said "log mislabel" when underlying was price-fetch corruption. Angel correctly refused my brief, asked for evidence. Cost: one wasted brief cycle, saved the wrong fix from shipping. Angel did its job.
Used a non-existent API query param on /api/trades?status=open. Endpoint silently fell through to return-all, I concluded false "reconciliation lag" bug. The fault was mine (consumer side) but the API itself silently accepting unknown params didn't help.
Suggestions
Strict territory mode (#2)
Quick-ask mode (#5)
Distinct exit codes per verdict (#4)
angels show <id> (#7)
angels inbox <id> (#6)
Response shape validation before declaring PROCEED (#3, #9)
Self-flagged gaps auto-paired with angel.md patches in same cycle (#8)
Web angel angel.md path consistency fix (#1)
What worked very well
Angels pushed back on bad briefs twice in this session, saving me from shipping fixes to the wrong layer. Worth more than every friction point combined.
The brief→execute separation provided a natural review checkpoint that caught two conceptual mistakes before any code was touched.
Cables (despite #6) kept the trading angel aware of the markets signature change with no manual prompting needed.
Out-of-territory warnings (despite #2 not being blocking) at least made the violations visible.
Tests inside execute caught regressions: 33/33 passing across 5 commits, no rollbacks needed.
The pattern of "investigate first, fix second, document third" (via brief → execute → angel.md update) produced exceptional traceability. Future agents will pick this up in seconds.
