import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeBrief } from '../protocol/brief.js';
import { invoke } from '../protocol/orchestrate.js';
import { appendNewspaper } from '../messaging/newspaper.js';
import type { ResponseData, ResponseVerdict } from '../protocol/response.js';

/**
 * Exit codes for the brief command:
 * 0 = proceed (angel has no concerns)
 * 1 = concerns (angel raised concerns but may proceed conditionally)
 * 2 = refuse (angel refuses the change — violates invariants)
 * 3 = error (angel encountered an error or produced no response)
 */
const EXIT_CODES: Record<ResponseVerdict, number> = {
  proceed: 0,
  concerns: 1,
  refuse: 2,
  done: 0, // should not happen in review, but don't crash
  error: 3,
};

/**
 * Run phase 1 (REVIEW) for an angel: write a brief, invoke the angel,
 * print a summary of the response.
 *
 * Returns the exit code (0 = proceed, 1 = concerns, 2 = refuse, 3 = error).
 */
export async function briefAngel(
  cwd: string,
  angelId: string,
  task: string,
): Promise<number> {
  // 1. Load config and validate angel exists
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  // 2. Write the brief
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

  // 3. Invoke the orchestrator in review mode
  const result = await invoke(cwd, {
    phase: 'review',
    angelId,
    briefPath,
  });

  // 4. Append a newspaper entry for the review
  appendBriefNewspaperEntry(cwd, angelId, result.response, task);

  // 5. Print human-readable summary
  printResponseSummary(result.response, result.responsePath);

  console.log('');
  console.log('----------------------------------------');
  console.log('NEXT STEP: angels execute ' + angelId + ' ' + briefPath);
  console.log('');
  console.log('DO NOT make these changes manually.');
  console.log('angel.md will not be updated and the audit trail');
  console.log('(cables, newspaper, FILES CHANGED) will be lost.');
  console.log('----------------------------------------');

  // 6. Return exit code based on the response verdict
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

/**
 * Print a human-readable summary of an angel's review response.
 */
function printResponseSummary(
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

  if (response.testResults) {
    console.log('TEST RESULTS:');
    for (const line of response.testResults.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  console.log(`Response file: ${responsePath}`);
}
