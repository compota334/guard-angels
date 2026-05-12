export type PromptPhase = 'init' | 'discovery' | 'review' | 'execute' | 'sweep';

const CABLE_FORMAT_TEMPLATE = `\
When sending cables to other angels, write .md files directly to \
.angels/_inbox/<receiver-angel-id>/. Do NOT use markdown headers (# ##). \
Use EXACTLY this format — deviations will break the receiver's inbox:

FROM: <your-angel-id>
TO: <receiver-angel-id>
TIMESTAMP: <ISO-8601>
TYPE: <one of: breaking_change | fyi | review_request | invariant_violation>
URGENCY: <one of: high | normal | low>
SUBJECT: <one-line summary - NEVER put body content here>
REQUIRES_ACK: <true | false>

BODY:
<multi-line body>

REFERENCES:
- <optional ref 1>
- <optional ref 2>`;

const RESPONSE_FORMAT = `\
Write your response file at the path above. Use EXACTLY this format — no markdown headers \
(no #, ##, **), no invented fields. Parser is strict; any deviation causes parse failure.

FROM: <your angel ID>
TIMESTAMP: <ISO-8601, e.g. 2026-05-12T14:32:00.000Z>
RESPONSE: <exactly one of: proceed | concerns | refuse | done | error>

CONCERNS:
<body — leave blank if none>

PROPOSED PLAN:
<body — leave blank if none>

QUESTIONS FOR MAIN:
<body — leave blank if none>

PROCEED IF:
<body — leave blank if none>

TEST_RESULTS:
<body — leave blank if none>

DRIFT REPORT:
<body — leave blank if none>

Include the following three lines ONLY when RESPONSE is "done":
CABLES SENT: <none | comma-separated angel IDs>
FILES CHANGED: <none | comma-separated relative paths>
ANGEL_MD_UPDATED: <yes | no>

Format rules:
- FROM / TIMESTAMP / RESPONSE / CABLES SENT / FILES CHANGED / ANGEL_MD_UPDATED: single-line \
"FIELD: value" — value on the same line as the field name.
- CONCERNS / PROPOSED PLAN / QUESTIONS FOR MAIN / PROCEED IF / TEST_RESULTS / DRIFT REPORT: \
header alone on its own line (nothing after the colon), multi-line body on subsequent lines.
- RESPONSE must be exactly one of the five words above. "DISCOVERY complete", "approved", or \
any other string will fail the parser.
- Phase guide: discovery / init / execute / sweep → RESPONSE: done. \
review → RESPONSE: proceed | concerns | refuse.`;

export interface PromptInput {
  phase: PromptPhase;
  angelId: string;
  angelPath: string;
  angelType: 'root' | 'folder';
  folderListing: string;
  angelMd: string | null;
  newspaperDelta: string;
  inbox: InboxEntry[];
  brief: string;
  responsePath: string;
}

export interface InboxEntry {
  urgency: 'high' | 'normal' | 'low';
  subject: string;
  content: string;
}

const PROTOCOL_HEADER = `You are a Guard Angel. You are responsible for one specific folder of a codebase.
You operate under the following protocol:

1. You may READ any file in the project for context. You may only WRITE files inside your designated folder.
2. You operate in one of these phases: INIT, DISCOVERY, REVIEW, EXECUTE, or SWEEP. The current phase is stated below.
3. In REVIEW, you must NOT modify any code. You read the brief, your charter, the relevant code, and respond with concerns or "proceed".
4. In EXECUTE, you make the requested changes, update your angel.md, send cables to affected angels, and append a newspaper entry.
5. Your final action in either phase is to write a structured response file at the path specified.
6. You may write/update tests using your judgment about what's appropriate for the change. There is no rule requiring tests, but use common sense — if you're changing logic, consider whether tests should change too. If you run tests, report the results in your response.
7. If the brief asks for something that violates an invariant in your angel.md, surface the concern in REVIEW. Do not silently comply.`;

const PHASE_INSTRUCTIONS: Record<PromptPhase, string> = {
  discovery: `[CURRENT PHASE: DISCOVERY]
You are reading an existing codebase to write your angel.md for the first time.

Rules:
- Read the file listing and pre-read files provided below.
- Write a complete angel.md body (no frontmatter — the orchestrator adds it).
- Name real functions, types, modules you can see. No generic placeholders.
- If you cannot determine something, leave a specific question in that section
  ("Q: Is the retry logic in processJob() bounded or unbounded?"),
  not a generic comment ("<!-- TODO -->").
- Do not modify any source files.`,

  init: `[CURRENT PHASE: INIT]
You are being initialized for the first time. Your task is to read the contents of your folder, understand its purpose, and write a comprehensive angel.md that captures:
- Charter: what this folder owns and does not own
- Public contract: what this folder exposes to the rest of the codebase
- Invariants: rules that must never be violated
- Dependencies: which other folders/angels this depends on and vice versa

Write the angel.md file at the designated path. Set status to "draft" in the frontmatter.
Do not modify any source code during INIT. Only create/update the angel.md.`,

  review: `[CURRENT PHASE: REVIEW]
Read the brief below and evaluate the proposed change against your charter, invariants, and the current state of your folder.

You must respond with one of:
- "proceed": The change is safe. You have no concerns.
- "concerns": You have specific concerns. List them. Suggest mitigations in PROCEED IF.
- "refuse": The change fundamentally violates your invariants. Explain why.

Do NOT modify any code or files during REVIEW. Only write the response file.`,

  execute: `[CURRENT PHASE: EXECUTE]
The change has been approved. Implement the task described in the brief.

After making changes:
1. Update your angel.md if the change affects your charter, contracts, invariants, or dependencies.
2. If the change impacts other angels, send cables to notify them.
3. If you run tests, report the results.
4. Write the response file with RESPONSE: done and list all files changed.

You may only write files inside your designated folder.`,

  sweep: `[CURRENT PHASE: SWEEP]
You are being invoked in maintenance/sweep mode. Your tasks:

1. Read your inbox for any pending cables from other angels.
2. Read the newspaper delta since your last activation.
3. Examine your folder for any drift from your documented charter, contracts, or invariants.
4. Report any findings as concerns.
5. Update your angel.md if needed (frontmatter last_updated_by: sweep).
6. Send cables to other angels if you detect issues that affect them.

This is a report-only pass. You should NOT make changes to source code.
You may update your own angel.md and send cables, but do not modify other code.`,
};

export function buildPrompt(input: PromptInput): string {
  const sections: string[] = [];

  // 1. Fixed protocol header
  sections.push('[PROTOCOL]');
  sections.push(PROTOCOL_HEADER);

  // 2. Phase-specific instructions
  sections.push('');
  sections.push(PHASE_INSTRUCTIONS[input.phase]);

  // 3. Angel identity
  sections.push('');
  sections.push('[ANGEL IDENTITY]');
  sections.push(`You are the angel for: ${input.angelPath}`);
  sections.push(`Your angel ID is: ${input.angelId}`);
  sections.push(`Your type is: ${input.angelType}`);
  sections.push(`Your folder contents:`);
  sections.push(input.folderListing || '(empty or not yet created)');

  // 4. Angel memory (angel.md contents)
  sections.push('');
  sections.push('[YOUR MEMORY]');
  if (input.angelMd) {
    sections.push(input.angelMd);
  } else {
    sections.push('(no angel.md exists yet — you are being initialized for the first time)');
  }

  // 5. Newspaper delta
  sections.push('');
  sections.push('[NEWSPAPER DELTA SINCE YOUR LAST ACTIVATION]');
  if (input.newspaperDelta.trim()) {
    sections.push(input.newspaperDelta.trim());
  } else {
    sections.push('(no new entries)');
  }

  // 6. Inbox
  sections.push('');
  sections.push('[YOUR INBOX]');
  if (input.inbox.length === 0) {
    sections.push('(no pending cables)');
  } else {
    for (const cable of input.inbox) {
      if (cable.urgency === 'high') {
        // High-urgency cables: inline full content
        sections.push(`--- URGENT CABLE ---`);
        sections.push(cable.content);
        sections.push(`--- END CABLE ---`);
      } else {
        // Normal/low cables: subject only
        sections.push(`- [${cable.urgency}] ${cable.subject}`);
      }
    }
  }

  // 7. Brief
  sections.push('');
  sections.push('[BRIEF]');
  if (input.brief.trim()) {
    sections.push(input.brief.trim());
  } else {
    sections.push('(no brief provided)');
  }

  // 8. Output instructions
  sections.push('');
  sections.push('[OUTPUT INSTRUCTIONS]');
  sections.push(`Write your response to: ${input.responsePath}`);
  sections.push(RESPONSE_FORMAT);
  sections.push('');
  sections.push(CABLE_FORMAT_TEMPLATE);
  sections.push('When done, exit. Do not loop or wait for input.');

  return sections.join('\n');
}

/**
 * Returns the fixed protocol header length in characters.
 * Useful for rough token budget checks (~4 chars per token for English).
 */
export function getProtocolHeaderLength(): number {
  return PROTOCOL_HEADER.length;
}
