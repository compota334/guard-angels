import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief } from '../protocol/brief.js';
import { invoke } from '../protocol/orchestrate.js';
import { appendNewspaper } from '../messaging/newspaper.js';
import { handleQuestionsForMain } from '../messaging/questions.js';
import { executeAngel } from './execute.js';
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
): Promise<number> {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  const timestamp = new Date().toISOString();
  const briefPath = writeBrief(cwd, {
    to: angelId,
    from: 'main',
    timestamp,
    phase: 'review',
    type: 'change_request',
    task,
    context: '',
    expectedScope: '',
    priorResponse: 'none',
  });

  console.log(`Brief written to: ${briefPath}`);

  const result = await invoke(cwd, {
    phase: 'review',
    angelId,
    briefPath,
  });

  appendReviewNewspaperEntry(cwd, angelId, result.response, task);
  printReviewSummary(result.response, result.responsePath);

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

  return executeAngel(cwd, angelId, briefPath);
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

function printReviewSummary(
  response: ResponseData,
  responsePath: string,
): void {
  const verdict = response.response.toUpperCase();

  console.log('');
  console.log(`=== Angel Response: ${verdict} ===`);
  console.log('');

  if (response.concerns) {
    console.log('CONCERNS:');
    for (const line of response.concerns.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  if (response.proposedPlan) {
    console.log('PROPOSED PLAN:');
    for (const line of response.proposedPlan.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  if (response.questionsForMain) {
    console.log('QUESTIONS FOR MAIN:');
    for (const line of response.questionsForMain.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  if (response.proceedIf) {
    console.log('PROCEED IF:');
    for (const line of response.proceedIf.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  console.log(`Response file: ${responsePath}`);
  console.log('');
}
