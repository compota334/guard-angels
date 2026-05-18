import { writeCable } from './cables.js';
import { appendNewspaper } from './newspaper.js';

/**
 * Handle a non-empty QUESTIONS FOR MAIN block from an angel's response.
 *
 * 1. Prints the questions prominently to stdout so the orchestrator sees them.
 * 2. Sends a cable from 'main' back to the angel acknowledging the questions
 *    are queued for review (type: review_request, urgency: normal).
 * 3. Logs a newspaper entry so the questions are auditable.
 */
export function handleQuestionsForMain(
  projectRoot: string,
  angelId: string,
  questions: string,
): void {
  console.log('');
  console.log('========================================');
  console.log(`QUESTIONS FOR MAIN (from ${angelId}):`);
  console.log('========================================');
  for (const line of questions.split('\n')) {
    console.log(`  ${line}`);
  }
  console.log('========================================');
  console.log('');

  const timestamp = new Date().toISOString();

  writeCable(projectRoot, {
    from: 'main',
    to: angelId,
    timestamp,
    type: 'review_request',
    urgency: 'normal',
    subject: `Questions received from ${angelId} — pending orchestrator review`,
    requiresAck: false,
    body: `The following questions were raised and are queued for orchestrator review:\n\n${questions.trim()}`,
    references: [],
  });

  appendNewspaper(projectRoot, {
    timestamp,
    angelId,
    summary: `Angel raised QUESTIONS FOR MAIN — cable queued for orchestrator review.`,
    details: questions.trim().slice(0, 500),
  });
}
