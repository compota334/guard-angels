import type { ResponseData } from '../protocol/response.js';

/**
 * Print a human-readable summary of an angel's response.
 *
 * Shared by the `brief` and `do` commands: prints the verdict header,
 * each populated section, and the path to the raw response file.
 */
export function printResponseSummary(
  response: ResponseData,
  responsePath: string,
): void {
  const verdict = response.response.toUpperCase();

  console.log('');
  console.log(`=== Angel Response: ${verdict} ===`);
  console.log('');

  const sections: Array<[string, string | undefined]> = [
    ['CONCERNS:', response.concerns],
    ['PROPOSED PLAN:', response.proposedPlan],
    ['QUESTIONS FOR MAIN:', response.questionsForMain],
    ['PROCEED IF:', response.proceedIf],
    ['TEST RESULTS:', response.testResults],
  ];

  for (const [header, body] of sections) {
    if (!body) continue;
    console.log(header);
    for (const line of body.split('\n')) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
  }

  console.log(`Response file: ${responsePath}`);
}
