import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { invoke } from '../protocol/orchestrate.js';
import type { ResponseData } from '../protocol/response.js';

/**
 * Ask an angel a read-only question and print the answer.
 *
 * Differences from brief:
 * - Phase is 'ask' — the angel is instructed to only answer, not change code.
 * - The brief is written to a system temp file and deleted after invocation.
 *   Nothing is persisted in .angels/_briefs/.
 * - No newspaper entry is appended (ephemeral consultation).
 * - No execute path is opened.
 *
 * Returns 0 on success, 1 on error.
 */
export async function askAngel(
  cwd: string,
  angelId: string,
  question: string,
): Promise<number> {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  const timestamp = new Date().toISOString();

  // Write brief to a temp file — not persisted in .angels/_briefs/
  const tmpBriefPath = path.join(
    os.tmpdir(),
    `angels-ask-${timestamp.replace(/[:.]/g, '-')}-${process.pid}.md`,
  );

  const briefContent = formatAskBrief(angelId, question, timestamp);
  fs.writeFileSync(tmpBriefPath, briefContent, 'utf-8');

  try {
    const result = await invoke(cwd, {
      phase: 'ask',
      angelId,
      briefPath: tmpBriefPath,
    });

    printAnswer(result.response, angelId);
    return 0;
  } finally {
    try {
      fs.unlinkSync(tmpBriefPath);
    } catch {
      // Best-effort cleanup
    }
  }
}

function formatAskBrief(angelId: string, question: string, timestamp: string): string {
  return [
    `TO: ${angelId}`,
    `FROM: main`,
    `TIMESTAMP: ${timestamp}`,
    `PHASE: ask`,
    `TYPE: consultation`,
    '',
    'TASK:',
    question,
    '',
    'CONTEXT:',
    '',
    'EXPECTED SCOPE:',
    '',
    `PRIOR RESPONSE: none`,
    '',
  ].join('\n');
}

function printAnswer(response: ResponseData, angelId: string): void {
  console.log('');
  console.log(`=== Answer from ${angelId} ===`);
  console.log('');

  if (response.proposedPlan && response.proposedPlan.trim()) {
    console.log(response.proposedPlan.trim());
  } else if (response.concerns && response.concerns.trim()) {
    console.log(response.concerns.trim());
  } else {
    console.log('(no answer provided)');
  }

  console.log('');
}
