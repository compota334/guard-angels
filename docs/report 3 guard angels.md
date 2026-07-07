Guard Angels field report #3 — empty PROPOSED PLAN regression
Incremental to reports #1 and #2. Previous categories were addressed in commits up through 61e75ee and confirmed working in production use (verified the NEXT STEP nudge, invariant gate, cable quarantine, retire, sweep --angel, etc. — all great).

What happened
Fresh install + full onboard of 8 angels in a real Python project:


$ angels init && angels create <7 folders> && angels onboard --angel <id> --force  (× 8)
... all 8 reported "angel.md written (status: draft)" ...
After onboard completed, every canonical angel.md file is 83 bytes — just YAML frontmatter, empty body:


$ wc -c .angels/*/angel.md .angels/_root/angel.md .angels/weather_bot/*/angel.md
 83 .angels/_root/angel.md
 83 .angels/export/angel.md
 83 .angels/scripts/angel.md
 83 .angels/weather_bot/angel.md
 83 .angels/weather_bot/markets/angel.md
 83 .angels/weather_bot/trading/angel.md
 83 .angels/weather_bot/weather/angel.md
 83 .angels/weather_bot/web/angel.md
But the angels DID generate real content (5KB–12KB charters with all 6 sections). The content went to non-canonical paths the orchestrator doesn't read:


$ ls -la .angels/*-*/*.md .angels/angel-*.md
 8848 .angels/weather_bot-markets/angel.md      ← angel wrote here (flat hyphen-encoded)
12044 .angels/weather_bot-weather/angel.md      ← angel wrote here (flat hyphen-encoded)
 9891 .angels/angel-weather_bot-web.md          ← angel wrote here (totally invented path)
The other 5 angels wrote their content to the canonical path (e.g., .angels/scripts/angel.md), which the orchestrator then overwrote with the empty proposedPlan field. Content lost.

Root cause
In src/protocol/prompt.ts, the RESPONSE_FORMAT template (introduced in commit 8765ebb) tells every angel in every phase:


PROPOSED PLAN:
<body — leave blank if none>
The angels read this as "list any plan for a future change here." During DISCOVERY there is no future change to plan — the task is "write your angel.md." So all 8 angels left PROPOSED PLAN: empty.

Meanwhile, src/commands/onboard.ts reads result.response.proposedPlan and uses it as the angel.md body:


const result = await invoke(cwd, { phase: 'discovery', ... });
const body = result.response.proposedPlan.trim();   // ← empty for all 8
writeAngelMd(mdPath, { frontmatter: {...}, body });   // ← writes 83-byte file
Result: empty body written, orchestrator reports "angel.md written (status: draft)", angel's actual content is either clobbered (canonical path collision) or stranded at a non-canonical path the orchestrator never looks at.

This is the 5th instance of the same prompt-fidelity pattern: the prompt names a destination/format without showing it explicitly. Previously fixed for response verdict, cable type, cable structure, and (added 020d9f0) anti-bypass nudge. This one slipped through when RESPONSE_FORMAT was made phase-agnostic.

Why all 4 previous fixes can't catch this
The current prompt does include strong format guidance:

✓ Explicit verbatim template
✓ "no markdown headers"
✓ "RESPONSE must be exactly one of"
✓ "Phase guide: discovery / init / execute / sweep → RESPONSE: done"
But none of that tells the angel what goes INTO the PROPOSED PLAN: section in DISCOVERY. The default angel reading — "plan = future-tense change" — leads to an empty field for a phase where the task itself produces the content.

Suggested fix
Restore phase-specific guidance for the PROPOSED PLAN section. The previous local patch I wrote (and that got replaced by the more concise upstream template) had this exact shape:


function getProposedPlanGuidance(phase: PromptPhase): string {
  if (phase === 'discovery' || phase === 'init') {
    return '<THE COMPLETE angel.md BODY — Charter, Public contract, Invariants, '
         + 'Decision log, Open questions, Dependencies. No YAML frontmatter. No '
         + 'surrounding code fences. This entire field is COPIED VERBATIM into '
         + 'your angel.md by the orchestrator. Do NOT write angel.md directly — '
         + 'put it here.>';
  }
  if (phase === 'review')  return '<the plan you propose for executing the brief>';
  if (phase === 'execute') return '<summary of what was actually done>';
  return '<summary>';
}
Then in RESPONSE_FORMAT (or a per-phase variant), inline this where it currently says <body — leave blank if none>. The key phrases that matter:

"the COMPLETE angel.md body" — sets expectation that this is a charter, not a future plan
"COPIED VERBATIM into your angel.md by the orchestrator" — tells the angel WHY this field matters
"Do NOT write angel.md directly — put it here" — kills the temptation to write the file at any path
Why the angels invented those bizarre paths
Side observation, possibly worth a separate small fix: the DISCOVERY phase instructions say "Write a complete angel.md body (no frontmatter — the orchestrator adds it)". The angel reads this and thinks "OK, I need to write a file called angel.md somewhere." Where it ends up writing:

.angels/weather_bot-markets/angel.md (the hyphen-encoded angel ID as a flat directory)
.angels/angel-weather_bot-web.md (literally angel-<id>.md as a flat file)
.angels/weather_bot/markets/angel.md (correct nested path — but orchestrator clobbers it)
The angel sees its angel ID is weather_bot-markets, sees .angels/ is the root state directory, and creatively constructs a path. None of these are wrong-headed in isolation — the prompt just never tells the angel that it doesn't need to write angel.md at all; the orchestrator writes it from the response.

The fix in (1) above handles this implicitly ("Do NOT write angel.md directly").

Verified manifestation across all 8 angels
Each response file in .angels/_responses/<id>/*.md has the exact same pattern:


PROPOSED PLAN:
                          ← empty (0 bytes between this header and the next)
QUESTIONS FOR MAIN:
1. <real question 1>      ← angels DID populate other sections
2. <real question 2>
...
FILES CHANGED: .angels/<some-path>/angel.md   ← angel claims it wrote a file
ANGEL_MD_UPDATED: yes                          ← angel claims success
This is reproducible on a clean install with the current main branch.

Recovery from this state (for any user hitting it)
The 3 angels that wrote to non-canonical paths can be recovered by moving their files:


mv .angels/weather_bot-markets/angel.md  .angels/weather_bot/markets/angel.md
mv .angels/weather_bot-weather/angel.md  .angels/weather_bot/weather/angel.md
mv .angels/angel-weather_bot-web.md      .angels/weather_bot/web/angel.md
rmdir .angels/weather_bot-markets .angels/weather_bot-weather
The other 5 (whose content was clobbered at canonical path) must be re-onboarded after the fix lands.

Why this is high-severity
Silent failure: orchestrator reports success ("angel.md written (status: draft)"). Operator doesn't know anything's wrong unless they manually inspect file sizes.
Activate works on broken state: angels activate --all would happily promote 8 empty-frontmatter angels to active, and a subsequent angels brief against any of them would invoke a session with a useless "memory" file.
First-onboard experience: for a new user, this fails on the very first command they care about (angels onboard). I would not have known the install was broken if I hadn't checked file sizes after the smoke test.
Suggested additional safeguard
Independent of the prompt fix: have onboard.ts validate that the body it's about to write is non-trivially populated (e.g., contains at least one of the expected section headers like ## Charter), and refuse to write if not:


const body = result.response.proposedPlan.trim();
if (!body || !/^##\s+(Charter|Public contract|Invariants)/m.test(body)) {
  throw new OrchestrationError(
    `Angel ${angel.id} returned an empty or malformed angel.md body in PROPOSED PLAN. ` +
    `Response file: ${result.responsePath}. The angel likely wrote angel.md to the wrong ` +
    `path or misunderstood the PROPOSED PLAN field. Re-onboard once the prompt is fixed.`,
    'empty_body', /* ... */
  );
}
This way, even if a future prompt-fidelity regression sneaks in, onboard fails loudly instead of silently writing empty files.

Summary
Issue	Severity	Fix
Empty PROPOSED PLAN for DISCOVERY/INIT → empty angel.md	High	Phase-specific guidance for the PROPOSED PLAN field (sample code above)
Angels invent angel.md paths	Medium	Same fix — "Do NOT write angel.md directly; put body in PROPOSED PLAN"
onboard.ts writes empty body without complaint	Medium	Add structural validation of body before write
Highest-impact single change: the getProposedPlanGuidance(phase) helper plus inlining it into the response template. Other 4 similar bugs were fixed with the same shape of patch — this is the same family.

That's the report. Eight angels currently in broken state (5 empty + 3 at wrong paths) but no destructive cleanup is needed yet — once the fix lands and you pull, I can:

Recover the 3 misplaced files via mv
Re-onboard the 5 lost ones
Activate

