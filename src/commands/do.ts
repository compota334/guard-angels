import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief } from '../protocol/brief.js';
import { invoke } from '../protocol/orchestrate.js';
import { appendNewspaper } from '../messaging/newspaper.js';
import {
  readInbox,
  archiveProcessedInbox,
  formatCablesAsContext,
  type ParsedCable,
} from '../messaging/cables.js';
import { handleQuestionsForMain } from '../messaging/questions.js';
import { executeAngel } from './execute.js';
import { printResponseSummary } from './response-summary.js';
import type { ResponseData, ResponseVerdict } from '../protocol/response.js';

const REVIEW_EXIT_CODES: Record<ResponseVerdict, number> = {
  proceed: 0,
  error: 1,
  concerns: 2,
  refuse: 3,
  done: 0,
};

/**
 * Combined brief + execute in one step.
 *
 * Phase 1 (review): sends task to angel, gets verdict.
 * If verdict is "proceed": automatically runs phase 2 (execute).
 * If verdict is "concerns" or "refuse": prints response, exits without executing.
 *
 * Exit codes:
 * 0 = execute completed (done)
 * 1 = error during review or execute
 * 2 = angel raised concerns — no execute performed
 * 3 = angel refused — no execute performed
 */
export async function doAngel(
  cwd: string,
  angelId: string,
  task: string,
  options: { strictTerritory?: boolean; consumeCables?: boolean } = {},
): Promise<number> {
  const consumeCables = options.consumeCables ?? true;

  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  // Inject pending inbox cables into the review brief (default behavior)
  let cableContext = '';
  let pendingCables: ParsedCable[] = [];
  if (consumeCables) {
    pendingCables = readInbox(cwd, angelId);
    if (pendingCables.length > 0) {
      cableContext = formatCablesAsContext(pendingCables);
      console.log(`Injecting ${pendingCables.length} pending cable(s) into brief context.`);
    }
  }

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

  const result = await invoke(cwd, {
    phase: 'review',
    angelId,
    briefPath,
  });

  // Archive cables now that the angel has seen them via the brief context
  if (consumeCables && pendingCables.length > 0) {
    archiveProcessedInbox(cwd, angelId);
  }

  appendReviewNewspaperEntry(cwd, angelId, result.response, task);
  printResponseSummary(result.response, result.responsePath);

  // Handle questions raised during the review phase (execute phase questions
  // are handled inside executeAngel via execute.ts)
  if (result.response.questionsForMain.trim()) {
    handleQuestionsForMain(cwd, angelId, result.response.questionsForMain);
  }

  const verdict = result.response.response;

  if (verdict !== 'proceed') {
    return REVIEW_EXIT_CODES[verdict];
  }

  console.log('Angel approved: auto-executing...');
  console.log('');

  return executeAngel(cwd, angelId, briefPath, options);
}

function appendReviewNewspaperEntry(
  cwd: string,
  angelId: string,
  response: ResponseData,
  task: string,
): void {
  const timestamp = new Date().toISOString();
  const verdict = response.response.toUpperCase();
  const taskSnippet = task.slice(0, 60).replace(/\n/g, ' ').trim();
  const summary = `DO reviewed. RESPONSE: ${verdict}. Task: ${taskSnippet}`;

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

