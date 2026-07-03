import type { MemoryConfig, AngelEntry } from '../config/schema.js';
import type { DeepDiscoveryContext } from './discovery-enhanced.js';
import type { WriteMode } from './response.js';
import type { Chunk } from './discovery-chunker.js';
import { getDenseTemplate } from '../angels/template.js';

export type PromptPhase = 'init' | 'discovery' | 'review' | 'execute' | 'sweep' | 'ask';

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

function getProposedPlanGuidance(phase: PromptPhase): string {
  if (phase === 'ask') return '<your full answer to the question — be specific, cite file paths and function names where relevant>';
  if (phase === 'discovery' || phase === 'init') {
    return (
      '<THE COMPLETE angel.md BODY — Charter, Public contract, Invariants, ' +
      'Decision log, Open questions, Dependencies. No YAML frontmatter. No ' +
      'surrounding code fences. This entire field is COPIED VERBATIM into ' +
      'your angel.md by the orchestrator. Do NOT write angel.md directly — ' +
      'put it here.>'
    );
  }
  if (phase === 'review') return '<the plan you propose for executing the brief>';
  if (phase === 'execute') return '<summary of what was actually done>';
  return '<body — leave blank if none>';
}

function buildResponseFormat(phase: PromptPhase): string {
  return (
    'Write your response file at the path above. Use EXACTLY this format — no markdown headers ' +
    '(no #, ##, **), no invented fields. Parser is strict; any deviation causes parse failure.\n' +
    '\n' +
    'FROM: <your angel ID>\n' +
    'TIMESTAMP: <ISO-8601, e.g. 2026-05-12T14:32:00.000Z>\n' +
    'RESPONSE: <exactly one of: proceed | concerns | refuse | done | error>\n' +
    '\n' +
    'CONCERNS:\n' +
    '<body — leave blank if none>\n' +
    '\n' +
    'PROPOSED PLAN:\n' +
    getProposedPlanGuidance(phase) +
    '\n' +
    '\n' +
    'QUESTIONS FOR MAIN:\n' +
    '<body — leave blank if none>\n' +
    '\n' +
    'PROCEED IF:\n' +
    '<body — leave blank if none>\n' +
    '\n' +
    'TEST_RESULTS:\n' +
    '<body — leave blank if none>\n' +
    '\n' +
    'DRIFT REPORT:\n' +
    '<body — leave blank if none>\n' +
    '\n' +
    'Include the following three lines ONLY when RESPONSE is "done":\n' +
    'CABLES SENT: <none | comma-separated angel IDs>\n' +
    'FILES CHANGED: <none | comma-separated relative paths>\n' +
    'ANGEL_MD_UPDATED: <yes | no>\n' +
    '\n' +
    'Format rules:\n' +
    '- FROM / TIMESTAMP / RESPONSE / CABLES SENT / FILES CHANGED / ANGEL_MD_UPDATED: single-line ' +
    '"FIELD: value" — value on the same line as the field name.\n' +
    '- CONCERNS / PROPOSED PLAN / QUESTIONS FOR MAIN / PROCEED IF / TEST_RESULTS / DRIFT REPORT: ' +
    'header alone on its own line (nothing after the colon), multi-line body on subsequent lines.\n' +
    '- RESPONSE must be exactly one of the five words above. "DISCOVERY complete", "approved", or ' +
    'any other string will fail the parser.\n' +
    '- Phase guide: discovery / init / execute / sweep / ask → RESPONSE: done. ' +
    'review → RESPONSE: proceed | concerns | refuse.'
  );
}

export interface PromptInput {
  phase: PromptPhase;
  angelId: string;
  angelPath: string;
  angelType: 'root' | 'folder';
  angelMdPath: string;
  folderListing: string;
  angelMd: string | null;
  newspaperDelta: string;
  inbox: InboxEntry[];
  brief: string;
  responsePath: string;
  angelNotes?: string;
  globalNotes?: string;
  chatHistory?: string;
  /**
   * Token budget for the angel.md injected into the prompt. In SWEEP the raw
   * angel.md is truncated to this budget; DISCOVERY/EXECUTE always get the full
   * memory. Undefined means no limit (inject in full regardless of phase).
   */
  memoryMaxTokens?: number;
}

/** Rough token estimate: ~4 characters per token. */
const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

/**
 * Truncate an angel.md to a token budget for the SWEEP phase, keeping the
 * leading portion (charter, contract, invariants live at the top of the dense
 * template) and appending a notice so the angel knows its memory was clipped.
 */
function truncateMemoryForSweep(angelMd: string, maxTokens: number): string {
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  const head = angelMd.slice(0, maxChars).trimEnd();
  const originalTokens = estimateTokens(angelMd);
  return (
    head +
    `\n\n[... angel.md truncated for SWEEP: kept ~${maxTokens} of ~${originalTokens} ` +
    `estimated tokens. Full memory is preserved on disk and used unabridged in ` +
    `DISCOVERY/EXECUTE. This report-only pass sees only the leading portion.]`
  );
}

export interface InboxEntry {
  urgency: 'high' | 'normal' | 'low';
  subject: string;
  content: string;
}

const PROTOCOL_HEADER = `You are a Guard Angel. You are responsible for one specific folder of a codebase.
You operate under the following protocol:

1. You may READ any file in the project for context. You may only WRITE files inside your designated folder. Exception: your angel.md (path listed in your identity section) is the sole file you may write outside your folder.
2. You operate in one of these phases: INIT, DISCOVERY, REVIEW, EXECUTE, or SWEEP. The current phase is stated below.
3. In REVIEW, you must NOT modify any code. You read the brief, your charter, the relevant code, and respond with concerns or "proceed".
4. In EXECUTE, you make the requested changes, update your angel.md, and send cables to affected angels. The orchestrator appends the newspaper entry automatically based on your response file. IMPORTANT: do NOT write to .angels/_newspaper.md or .angels/_newspaper/. Your only job is to fill in CABLES SENT, FILES CHANGED, ANGEL_MD_UPDATED in the response.
5. Your final action in either phase is to write a structured response file at the path specified.
6. You may write/update tests using your judgment about what's appropriate for the change. There is no rule requiring tests, but use common sense — if you're changing logic, consider whether tests should change too. If you run tests, report the results in your response.
7. If the brief asks for something that violates an invariant in your angel.md, surface the concern in REVIEW. Do not silently comply.
8. Communication channels: use structured files (angel.md, cables, briefs, newspaper) for persistent, documentable decisions. The .angels/_chat/<angel-id>.md channel is for lightweight operational notes from the orchestrator — not formal protocol. You can read chat history but you do not write to it.`;

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
1. Update your angel.md (path listed in your identity section) if the change affects your charter, contracts, invariants, or dependencies. This is the one write exception outside your designated folder — see rule 1.
2. If the change impacts other angels, send cables to notify them.
3. If you run tests, report the results.
4. Write the response file with RESPONSE: done and list all files changed.

You may only write files inside your designated folder, plus your angel.md at the path in your identity section.`,

  ask: `[CURRENT PHASE: ASK]
This is a read-only consultation. The user has a question for you.

Rules:
- Read your angel.md and any relevant files in your folder to answer accurately.
- Do NOT modify any files.
- Do NOT send cables.
- Write RESPONSE: done and put your complete answer in PROPOSED PLAN.
- Be specific: cite file paths, function names, line ranges where helpful.
- If you cannot answer with confidence, say so explicitly — do not guess.`,

  sweep: `[CURRENT PHASE: SWEEP]
You are being invoked in maintenance/sweep mode. Your tasks:

1. Read your inbox for any pending cables from other angels.
2. Read the newspaper delta since your last activation.
3. Examine your folder for any drift from your documented charter, contracts, or invariants.
4. Report any findings as concerns.
5. Update your angel.md if needed (frontmatter last_updated_by: sweep).
6. Send cables to other angels if you detect issues that affect them.

This is a report-only pass. You should NOT make changes to source code.
You may update your own angel.md and send cables, but do not modify other code.

SWEEP is read-only. Do NOT run rm, mv, or write files outside angel.md. The orchestrator already verified the state before invoking you. Your job is to REPORT drift, not fix it or verify it destructively.`,
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
  sections.push(`Your angel.md path: ${input.angelMdPath}`);
  sections.push(`Your folder contents:`);
  sections.push(input.folderListing || '(empty or not yet created)');

  // 4. Angel memory (angel.md contents)
  sections.push('');
  sections.push('[YOUR MEMORY]');
  if (input.angelMd) {
    if (
      input.phase === 'sweep' &&
      input.memoryMaxTokens != null &&
      estimateTokens(input.angelMd) > input.memoryMaxTokens
    ) {
      sections.push(truncateMemoryForSweep(input.angelMd, input.memoryMaxTokens));
    } else {
      sections.push(input.angelMd);
    }
  } else {
    sections.push('(no angel.md exists yet — you are being initialized for the first time)');
  }

  // 5. Chat history
  sections.push('');
  sections.push('[CHAT HISTORY]');
  if (input.chatHistory && input.chatHistory.trim()) {
    sections.push(input.chatHistory.trim());
  } else {
    sections.push('(no chat history)');
  }

  // 6. Newspaper delta
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

  // 7. Known issues / global notes (omitted entirely when both are absent)
  const hasGlobalNotes = input.globalNotes && input.globalNotes.trim();
  const hasAngelNotes = input.angelNotes && input.angelNotes.trim();
  if (hasGlobalNotes || hasAngelNotes) {
    sections.push('');
    sections.push('[KNOWN ISSUES / GLOBAL NOTES]');
    if (hasGlobalNotes) {
      sections.push(input.globalNotes!.trim());
    }
    if (hasAngelNotes) {
      sections.push('--- Angel-specific notes ---');
      sections.push(input.angelNotes!.trim());
    }
  }

  // 8. Brief
  sections.push('');
  sections.push('[BRIEF]');
  if (input.brief.trim()) {
    sections.push(input.brief.trim());
  } else {
    sections.push('(no brief provided)');
  }

  // 9. Output instructions
  sections.push('');
  sections.push('[OUTPUT INSTRUCTIONS]');
  sections.push(`Write your response to: ${input.responsePath}`);
  sections.push(buildResponseFormat(input.phase));
  sections.push('');
  sections.push(CABLE_FORMAT_TEMPLATE);
  sections.push('When done, exit. Do not loop or wait for input.');

  return sections.join('\n');
}

// ─── Prompt size diagnostics ──────────────────────────────────────────────────

export interface PromptSizeReport {
  totalBytes: number;
  /** Per-section byte sizes, including a synthetic "fixed" entry for boilerplate. */
  sections: { name: string; bytes: number }[];
}

/**
 * Measure the byte size of the variable-length inputs that dominate a prompt.
 *
 * Used to produce a diagnostic breakdown when a prompt grows unexpectedly large.
 * The fixed protocol/phase/output boilerplate (everything not attributable to a
 * specific input field) is grouped under the synthetic "fixed" section so the
 * per-section bytes plus "fixed" sum to the prompt's total byte length.
 */
export function measurePromptSize(prompt: string, input: PromptInput): PromptSizeReport {
  const b = (s: string | null | undefined): number => (s ? Buffer.byteLength(s) : 0);
  const inboxBytes = input.inbox.reduce(
    (sum, c) => sum + Buffer.byteLength(c.content || c.subject || ''),
    0,
  );

  const sections = [
    { name: 'angelMd', bytes: b(input.angelMd) },
    { name: 'folderListing', bytes: b(input.folderListing) },
    { name: 'newspaperDelta', bytes: b(input.newspaperDelta) },
    { name: 'inbox', bytes: inboxBytes },
    { name: 'brief', bytes: b(input.brief) },
    { name: 'chatHistory', bytes: b(input.chatHistory) },
    { name: 'globalNotes', bytes: b(input.globalNotes) },
    { name: 'angelNotes', bytes: b(input.angelNotes) },
  ];

  const totalBytes = Buffer.byteLength(prompt);
  const variable = sections.reduce((sum, s) => sum + s.bytes, 0);
  sections.push({ name: 'fixed', bytes: Math.max(0, totalBytes - variable) });

  return { totalBytes, sections };
}

/**
 * Format a human-readable, stderr-bound warning for an oversized prompt,
 * with a per-section byte breakdown sorted largest-first.
 */
export function formatPromptSizeWarning(
  angelId: string,
  phase: PromptPhase,
  report: PromptSizeReport,
  thresholdBytes: number,
): string {
  const breakdown = [...report.sections]
    .sort((a, b) => b.bytes - a.bytes)
    .map((s) => `${s.name}=${s.bytes}`)
    .join(' ');
  return (
    `[guard-angel][warn] prompt for angel "${angelId}" (phase=${phase}) is ${report.totalBytes} bytes, ` +
    `exceeds threshold ${thresholdBytes} bytes\n` +
    `[guard-angel][warn]   breakdown (bytes): ${breakdown}`
  );
}

// ─── Dense Discovery Prompt ───────────────────────────────────────────────────

/**
 * Check whether the dense template should be used based on memory config.
 * Returns true if target_pct > 5 (indicating a large/full-context angel.md is desired).
 */
export function useDenseTemplate(memory: MemoryConfig | undefined): boolean {
  if (!memory) return false;
  const pct = memory.target_pct ?? 25;
  return pct > 5;
}

/**
 * Check whether the dense template should be used based on angel memory config.
 * Unlike `useDenseTemplate`, this accepts a plain config object (not necessarily
 * the full MemoryConfig type) and also checks `max_tokens > 5000`.
 *
 * Returns true if:
 * - target_pct > 5, OR
 * - max_tokens > 5000
 * Returns false if no config is provided (backward compatible).
 */
export function shouldUseDenseTemplate(angelMemory?: { target_pct?: number; max_tokens?: number }): boolean {
  if (!angelMemory) return false;
  if ((angelMemory.target_pct ?? 0) > 5) return true;
  if ((angelMemory.max_tokens ?? 0) > 5000) return true;
  return false;
}

/**
 * Build a discovery prompt for the DISCOVERY phase.
 *
 * If the memory config indicates a dense template (target_pct > 5),
 * this function switches to the deep discovery context and dense template.
 * Otherwise, it delegates to the standard `buildPrompt()` behavior
 * (backward compatible).
 *
 * @param params - Parameters for building the discovery prompt
 * @returns The complete prompt string
 */
export function buildDiscoveryPrompt(params: {
  angel: AngelEntry;
  context: DeepDiscoveryContext;
  globalMemoryConfig?: MemoryConfig;
  responsePath: string;
  /** When true, instruct the angel to write angel.md directly to the filesystem. */
  directWrite?: boolean;
  /** Write mode — 'direct' or 'proposed' (default). Takes precedence over directWrite when set. */
  writeMode?: WriteMode;
  /** Absolute path to the angel.md file. Required when directWrite is true. */
  angelMdPath?: string;
}): string {
  const { angel, context, globalMemoryConfig, responsePath, directWrite, writeMode, angelMdPath } = params;
  const memory = angel.memory ?? globalMemoryConfig;

  if (useDenseTemplate(memory)) {
    return buildDenseDiscoveryPrompt({
      angel,
      context,
      memoryConfig: context.memoryConfig,
      responsePath,
      directWrite,
      writeMode,
      angelMdPath,
    });
  }

  // Standard (backward compatible) discovery prompt — same structure as buildPrompt
  const sections: string[] = [];

  sections.push('[PROTOCOL]');
  sections.push(PROTOCOL_HEADER);

  sections.push('');
  sections.push(PHASE_INSTRUCTIONS['discovery']);

  sections.push('');
  sections.push('[ANGEL IDENTITY]');
  const pathDesc = angel.type === 'root' ? '.' : angel.path;
  sections.push(`You are the angel for: ${pathDesc}`);
  sections.push(`Your angel ID is: ${angel.id}`);
  sections.push(`Your type is: ${angel.type}`);
  sections.push('');
  sections.push('## Territory File Listing');
  sections.push('');
  const fileLines: string[] = [];
  for (const cf of context.classifiedFiles) {
    fileLines.push(`- [${cf.value}] ${cf.path} (${cf.language}, ${cf.sizeBytes} bytes)`);
  }
  sections.push(fileLines.join('\n'));

  sections.push('');
  sections.push('## High Value Files (full content)');
  sections.push(context.highValueContent || '(none)');

  sections.push('');
  sections.push('## Medium Value Files (stubs)');
  sections.push(context.mediumValueStubs || '(none)');

  sections.push('');
  sections.push('## Low Value Files');
  sections.push(context.lowValueListing || '(none)');

  sections.push('');
  sections.push('[OUTPUT INSTRUCTIONS]');
  sections.push(`Write your response to: ${responsePath}`);
  sections.push(buildResponseFormat('discovery'));
  sections.push('');
  sections.push(CABLE_FORMAT_TEMPLATE);
  sections.push('When done, exit. Do not loop or wait for input.');

  return sections.join('\n');
}

/**
 * Build a dense discovery prompt using the deep discovery context and
 * the 11-section dense template.
 *
 * Instructs the angel to generate a dense angel.md optimized for the
 * available token budget, skipping boilerplate, imports, and obvious
 * conventions.
 *
 * @param params - Parameters for building the dense discovery prompt
 * @returns The complete dense prompt string
 */
export function buildDenseDiscoveryPrompt(params: {
  angel: AngelEntry;
  context: DeepDiscoveryContext;
  memoryConfig: { targetPct: number; maxTokens: number };
  responsePath: string;
  /** When true, instruct the angel to write angel.md directly to the filesystem
   *  instead of embedding it in PROPOSED PLAN. Requires angelMdPath. */
  directWrite?: boolean;
  /** Write mode — 'direct' or 'proposed' (default). Takes precedence over directWrite when set. */
  writeMode?: WriteMode;
  /** Absolute path to the angel.md file. Required when directWrite is true. */
  angelMdPath?: string;
}): string {
  const { angel, context, memoryConfig, responsePath, directWrite, writeMode, angelMdPath } = params;
  const pathDesc = angel.type === 'root' ? '.' : angel.path;
  const denseTemplate = getDenseTemplate(pathDesc, angel.type);

  const sections: string[] = [];

  // 1. Protocol header
  sections.push('[PROTOCOL]');
  sections.push(PROTOCOL_HEADER);

  // 2. Dense discovery instructions
  sections.push('');
  sections.push('[CURRENT PHASE: DISCOVERY — DENSE MODE]');
  sections.push(
    `You are generating a DENSE angel.md. Target size: ~${memoryConfig.maxTokens} tokens. ` +
      'Skip boilerplate, imports, obvious conventions. Cover ALL files in your territory.',
  );
  sections.push('');
  sections.push(
    `Budget allocated: ${memoryConfig.targetPct}% of context window (${memoryConfig.maxTokens} max tokens). ` +
      `Files in territory: ${context.stats.totalFiles} (high: ${context.stats.highValueFiles}, ` +
      `medium: ${context.stats.mediumValueFiles}, low: ${context.stats.lowValueFiles}). ` +
      `Boilerplate lines skipped: ${context.stats.boilerplateLinesSkipped}. ` +
      `Compression ratio: ${context.stats.compressionRatio}%.`,
  );
  sections.push('');
  sections.push(
    'Rules:\n' +
      '- Read the deep discovery context below (classified files, full content of high-value files, stubs of medium-value files).\n' +
      '- Write a DENSE angel.md body (no YAML frontmatter — the orchestrator adds it).\n' +
      '- Use the template structure provided below. Fill EVERY section with real content extracted from the code.\n' +
      '- Name real functions, types, modules you can see. No generic placeholders.\n' +
      '- If you cannot determine something, leave a specific question (e.g. "Q: Is retry logic bounded or unbounded?").\n' +
      '- Do NOT include imports, JSDoc comments, standard framework decorators, or obvious boilerplate.\n' +
      '- Do not modify any source files.',
  );

  // 3. Angel identity
  sections.push('');
  sections.push('[ANGEL IDENTITY]');
  sections.push(`You are the angel for: ${pathDesc}`);
  sections.push(`Your angel ID is: ${angel.id}`);
  sections.push(`Your type is: ${angel.type}`);

  // 4. Discovery stats
  sections.push('');
  sections.push('[DISCOVERY STATS]');
  sections.push(
    `Total files: ${context.stats.totalFiles} | ` +
      `High value: ${context.stats.highValueFiles} | ` +
      `Medium value: ${context.stats.mediumValueFiles} | ` +
      `Low value: ${context.stats.lowValueFiles}`,
  );
  sections.push(
    `Boilerplate skipped: ${context.stats.boilerplateLinesSkipped} lines | ` +
      `Useful lines kept: ${context.stats.usefulLinesKept} | ` +
      `Compression: ${context.stats.compressionRatio}%`,
  );

  // 5. File listing (classified)
  sections.push('');
  sections.push('[CLASSIFIED FILE LISTING]');
  const listing: string[] = [];
  for (const cf of context.classifiedFiles) {
    listing.push(
      `- [${cf.value}] ${cf.path} (${cf.language}, ${cf.sizeBytes} bytes) — ${cf.reason}`,
    );
  }
  sections.push(listing.join('\n'));

  // 6. High value content
  sections.push('');
  sections.push('[HIGH VALUE FILES — FULL CONTENT]');
  sections.push(
    context.highValueContent || '(no high-value files found)',
  );

  // 7. Medium value stubs
  sections.push('');
  sections.push('[MEDIUM VALUE FILES — STUBS]');
  sections.push(
    context.mediumValueStubs || '(no medium-value files found)',
  );

  // 8. Low value listing
  sections.push('');
  sections.push('[LOW VALUE FILES — LISTING]');
  sections.push(
    context.lowValueListing || '(no low-value files found)',
  );

  // 9. Template guidance — emit the dense template as reference
  sections.push('');
  sections.push('[DENSE TEMPLATE — USE THIS STRUCTURE]');
  sections.push(denseTemplate);

  const isDirect = writeMode === 'direct' || directWrite === true;

  // 10. Output instructions
  sections.push('');
  sections.push('[OUTPUT INSTRUCTIONS]');

  if (isDirect && angelMdPath) {
    // Direct write mode: angel writes angel.md directly to the filesystem
    // and indicates success via WRITE_MODE: DIRECT header
    sections.push(`WRITE angel.md directly at: ${angelMdPath}`);
    sections.push('');
    sections.push(
      '1. Write the complete angel.md body (no YAML frontmatter) to that path.\n' +
      '2. In your response, start with WRITE_MODE: DIRECT then RESPONSE: done.\n' +
      '   On failure, use RESPONSE: error.\n' +
      'DO NOT include the angel.md body in PROPOSED PLAN (leave it empty).',
    );
    sections.push('');
    sections.push(
      'The body MUST follow the Dense Template structure above. ' +
      'Be specific: reference actual function names, types, modules, and file paths from the discovery context.',
    );
  } else {
    // Legacy mode: angel writes body in PROPOSED PLAN field
    sections.push(
      `Write your response (the complete angel.md body) to: ${responsePath}`,
    );
    sections.push(
      'Write ONLY the angel.md body (no frontmatter, no surrounding code fences, no extra commentary). ' +
      'The body MUST follow the Dense Template structure above. ' +
      'Be specific: reference actual function names, types, modules, and file paths from the discovery context.',
    );
  }
  sections.push('');
  sections.push(CABLE_FORMAT_TEMPLATE);
  sections.push('');
  sections.push('When done, exit. Do not loop or wait for input.');

  return sections.join('\n');
}

// ─── Chunked Writing Prompts ──────────────────────────────────────────────────

/**
 * Build a prompt for writing a single chunk of a large angel.md.
 *
 * For chunk 0 (first): instructs the angel to write the FIRST chunk with
 * WRITE_MODE: CHUNK and specific sections.
 *
 * For chunks 1+ (subsequent): tells the angel which sections are already
 * written and which new sections to generate, using WRITE_MODE: CHUNK
 * (or CHUNK_FINAL for the last chunk).
 *
 * @param params - Parameters for building the chunk prompt
 * @returns The complete chunk prompt string
 */
export function buildChunkPrompt(params: {
  angel: AngelEntry;
  chunk: Chunk;
  deepContext: DeepDiscoveryContext;
  existingAngelMd?: string;
  chunkIndex: number;
  totalChunks: number;
}): string {
  const { angel, chunk, deepContext, existingAngelMd, chunkIndex, totalChunks } = params;
  const pathDesc = angel.type === 'root' ? '.' : angel.path;
  const isFirst = chunkIndex === 0;
  const isLast = chunkIndex === totalChunks - 1;
  const writeModeTag = isLast ? 'CHUNK_FINAL' : 'CHUNK';

  const sections: string[] = [];

  sections.push('[PROTOCOL]');
  sections.push(PROTOCOL_HEADER);
  sections.push('');

  if (isFirst) {
    sections.push('[CURRENT PHASE: DISCOVERY — CHUNKED WRITE, FIRST CHUNK]');
    sections.push('');
    sections.push(
      `You are writing the FIRST chunk of the angel.md for ${pathDesc}. ` +
        `The full angel.md will be written in ${totalChunks} chunks.`,
    );
    sections.push('');
    sections.push(`Generate these sections:\n${chunk.sections.join(', ')}`);
    sections.push('');
    sections.push(
      'Write ONLY these sections. Do NOT include other sections. ' +
        'Use appendAngelMd() to write the body. ' +
        'Start your response with WRITE_MODE: CHUNK then RESPONSE: done.',
    );
  } else {
    const previousSections = getAllPreviousSections(chunkIndex);

    sections.push('[CURRENT PHASE: DISCOVERY — CHUNKED WRITE]');
    sections.push('');
    sections.push(
      `You are writing chunk ${chunkIndex + 1}/${totalChunks} of the angel.md for ${pathDesc}.`,
    );
    sections.push('');
    sections.push(`Sections already written:\n${previousSections.join(', ')}`);
    sections.push('');
    if (existingAngelMd) {
      sections.push(
        'Current content (first 500 chars for reference):\n' +
          existingAngelMd.slice(0, 500),
      );
      sections.push('');
    }
    sections.push(`Generate these NEW sections:\n${chunk.sections.join(', ')}`);
    sections.push('');
    sections.push(
      'Do NOT repeat sections already written. ' +
        'Use appendAngelMd() to append the new content. ' +
        `Start your response with WRITE_MODE: ${writeModeTag} then RESPONSE: done.`,
    );
  }

  // Discovery context reference
  sections.push('');
  sections.push('[DISCOVERY CONTEXT]');
  sections.push(`Total files: ${deepContext.stats.totalFiles} | ` +
    `High value: ${deepContext.stats.highValueFiles} | ` +
    `Medium value: ${deepContext.stats.mediumValueFiles} | ` +
    `Low value: ${deepContext.stats.lowValueFiles}`);
  sections.push('');

  // Add relevant context based on which sections are being generated
  const needsFileContent =
    chunk.sections.includes('Cobertura de Código') ||
    chunk.sections.includes('Arquitectura del Área');
  const needsHighValue =
    chunk.sections.includes('Cobertura de Código');

  if (needsFileContent) {
    sections.push('[CLASSIFIED FILE LISTING]');
    for (const cf of deepContext.classifiedFiles) {
      sections.push(
        `- [${cf.value}] ${cf.path} (${cf.language}, ${cf.sizeBytes} bytes) — ${cf.reason}`,
      );
    }
    sections.push('');
  }

  if (needsHighValue && deepContext.highValueContent) {
    sections.push('[HIGH VALUE FILES — FULL CONTENT]');
    sections.push(deepContext.highValueContent);
    sections.push('');
  }

  if (needsFileContent && !isFirst && deepContext.highValueContent) {
    sections.push('[MEDIUM VALUE FILES — STUBS]');
    sections.push(deepContext.mediumValueStubs || '(none)');
    sections.push('');
  }

  // Output instructions
  sections.push('[OUTPUT INSTRUCTIONS]');
  sections.push(
    '1. Start your response with WRITE_MODE: ' + writeModeTag + '\n' +
    '2. Then RESPONSE: done\n' +
    '3. DO NOT include the angel.md body in your response — use appendAngelMd() to write it\n' +
    '4. Use the discovery context above for accurate file references',
  );
  sections.push('');
  sections.push(CABLE_FORMAT_TEMPLATE);
  sections.push('');
  sections.push('When done, exit. Do not loop or wait for input.');

  return sections.join('\n');
}

/**
 * Build a finalize prompt to verify a chunked angel.md after all chunks are written.
 *
 * Instructs the angel to verify the complete file has all 11 sections,
 * frontmatter timestamp is current, and no section is empty or has TODO/TBD placeholders.
 *
 * @param params - Parameters for building the finalize prompt
 * @returns The complete finalize prompt string
 */
export function buildFinalizePrompt(params: {
  angel: AngelEntry;
  deepContext: DeepDiscoveryContext;
  finalAngelMd: string;
}): string {
  const { angel, finalAngelMd } = params;
  const pathDesc = angel.type === 'root' ? '.' : angel.path;

  const sections: string[] = [];

  sections.push('[PROTOCOL]');
  sections.push(PROTOCOL_HEADER);
  sections.push('');

  sections.push('[CURRENT PHASE: DISCOVERY — FINALIZE CHUNKED WRITE]');
  sections.push('');
  sections.push(
    `All chunks have been written to .angels/${angel.id}/angel.md for ${pathDesc}.`,
  );
  sections.push('');
  sections.push('Verify the file is complete and correct:');
  sections.push('1. Check that all 11 sections are present');
  sections.push('2. Check frontmatter has last_updated: now');
  sections.push('3. Check no section is empty or says \'TODO\' or \'TBD\'');
  sections.push('4. If anything is missing, write a brief CHUNK_FIX with the missing sections');
  sections.push('');
  sections.push('[FINAL ANGEL.MD CONTENT]');
  sections.push(finalAngelMd.slice(0, 3000)); // first 3000 chars as reference
  sections.push('');
  sections.push('[OUTPUT INSTRUCTIONS]');
  sections.push(
    '1. If everything looks good, respond with RESPONSE: done and WRITE_MODE: CHUNK_FINAL\n' +
    '2. If sections are missing or incomplete, describe what needs fixing\n' +
    '3. Do NOT rewrite angel.md — just verify and report',
  );
  sections.push('');
  sections.push(CABLE_FORMAT_TEMPLATE);
  sections.push('');
  sections.push('When done, exit. Do not loop or wait for input.');

  return sections.join('\n');
}

/**
 * Get the list of section names from chunks before the current index.
 */
function getAllPreviousSections(chunkIndex: number): string[] {
  // These are the standard section groupings per chunk index
  const chunkSections: string[][] = [
    ['Charter y Boundaries', 'Arquitectura del Área', 'Public Contract', 'Invariantes y Reglas de Negocio'],
    ['Cobertura de Código'],
    ['Cobertura de Código', 'Data Model'],
    ['Flujos Críticos', 'Testing Patterns'],
    ['Decision Log', 'Known Debt y TODO', 'Dependencies'],
  ];

  const previous: string[] = [];
  for (let i = 0; i < chunkIndex && i < chunkSections.length; i++) {
    previous.push(...chunkSections[i]);
  }
  return previous;
}
