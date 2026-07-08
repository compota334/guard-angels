import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief } from '../protocol/brief.js';
import { invoke } from '../protocol/orchestrate.js';
import { appendNewspaper } from '../messaging/newspaper.js';
import {
  readInbox,
  archiveProcessedInbox,
  formatCablesAsContext,
} from '../messaging/cables.js';
import { handleQuestionsForMain } from '../messaging/questions.js';
import { printResponseSummary } from './response-summary.js';
import type { ResponseData, ResponseVerdict } from '../protocol/response.js';
import type { ParsedCable } from '../messaging/cables.js';

/**
 * Exit codes for the brief command:
 * 0 = proceed (angel has no concerns)
 * 1 = error (angel encountered an error or produced no response)
 * 2 = concerns (angel raised concerns but may proceed conditionally)
 * 3 = refuse (angel refuses the change — violates invariants)
 *
 * error uses 1 (not 2/3) so that `set -e` and shell monitors catch real failures
 * without treating a legitimate "concerns" verdict as a hard error.
 */
const EXIT_CODES: Record<ResponseVerdict, number> = {
  proceed: 0,
  error: 1,
  concerns: 2,
  refuse: 3,
  done: 0, // should not happen in review, but don't crash
};

export interface BriefOptions {
  /** Inject pending inbox cables into the brief and archive them after. Default: true. */
  consumeCables?: boolean;
}

/**
 * Run phase 1 (REVIEW) for an angel: write a brief, invoke the angel,
 * print a summary of the response.
 *
 * Pending inbox cables are injected as context in the brief and archived
 * after the angel has seen them (a postal service should not need the
 * president to deliver letters). Opt out with consumeCables=false.
 *
 * Returns the exit code (0 = proceed, 1 = error, 2 = concerns, 3 = refuse).
 */
export async function briefAngel(
  cwd: string,
  angelId: string,
  task: string,
  options: BriefOptions = {},
): Promise<number> {
  const consumeCables = options.consumeCables ?? true;

  // 1. Load config and validate angel exists
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  // 2. Read inbox cables to inject as context (default behavior)
  let cableContext = '';
  let pendingCables: ParsedCable[] = [];
  if (consumeCables) {
    pendingCables = readInbox(cwd, angelId);
    if (pendingCables.length > 0) {
      cableContext = formatCablesAsContext(pendingCables);
      console.log(`Injecting ${pendingCables.length} pending cable(s) into brief context.`);
    }
  }

  // 3. Write the brief
  const timestamp = new Date().toISOString();
  const briefPath = writeBrief(cwd, {
    to: angelId,
    from: 'main',
    timestamp,
    phase: 'review',
    type: 'change_request',
    task,
    context: cableContext,
    expectedScope: '',
    priorResponse: 'none',
  });

  console.log(`Brief written to: ${briefPath}`);

  // 4. Invoke the orchestrator in review mode
  const result = await invoke(cwd, {
    phase: 'review',
    angelId,
    briefPath,
  });

  // 5. Archive cables now that the angel has seen them via the brief context
  if (consumeCables && pendingCables.length > 0) {
    archiveProcessedInbox(cwd, angelId);
  }

  // 5b. Route questions back to main's inbox if the angel raised any
  if (result.response.questionsForMain.trim()) {
    handleQuestionsForMain(cwd, angelId, result.response.questionsForMain);
  }

  // 6. Append a newspaper entry for the review
  appendBriefNewspaperEntry(cwd, angelId, result.response, task);

  // 7. Print human-readable summary
  printResponseSummary(result.response, result.responsePath);

  console.log('');
  console.log('----------------------------------------');
  console.log('NEXT STEP: angels execute ' + angelId + ' ' + briefPath);
  console.log('');
  console.log('DO NOT make these changes manually.');
  console.log('angel.md will not be updated and the audit trail');
  console.log('(cables, newspaper, FILES CHANGED) will be lost.');
  console.log('----------------------------------------');

  // 8. Return exit code based on the response verdict
  return EXIT_CODES[result.response.response];
}

/**
 * Append a newspaper entry for the brief/review result.
 */
function appendBriefNewspaperEntry(
  cwd: string,
  angelId: string,
  response: ResponseData,
  task: string,
): void {
  const timestamp = new Date().toISOString();
  const verdict = response.response.toUpperCase();
  const taskSnippet = task.slice(0, 60).replace(/\n/g, ' ').trim();
  const summary = `BRIEF reviewed. RESPONSE: ${verdict}. Task: ${taskSnippet}`;

  const detailLines: string[] = [];
  if (response.concerns) {
    detailLines.push(`Concerns: ${response.concerns}`);
  }
  if (response.proceedIf) {
    detailLines.push(`Proceed if: ${response.proceedIf}`);
  }

  appendNewspaper(cwd, {
    timestamp,
    angelId,
    summary,
    details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
  });
}

