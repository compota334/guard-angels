import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { resolve as resolvePath } from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readAngelMd, writeAngelMd } from '../angels/memory.js';
import { angelMdFile } from '../paths/layout.js';
import { angelIdToPath } from '../paths/resolve.js';
import { buildDiscoveryContext } from '../protocol/discovery.js';
import { invoke } from '../protocol/orchestrate.js';
import { writeBrief } from '../protocol/brief.js';
import type { Config, AngelEntry } from '../config/schema.js';

export interface OnboardOptions {
  angel?: string;
  force?: boolean;
  autoActivate?: boolean;
  depth?: number;
}

export async function onboardAngels(cwd: string, opts: OnboardOptions): Promise<void> {
  const config = ensureInit(cwd);
  const registry = AngelRegistry.fromConfig(config);
  const targets = selectAngels(registry, opts.angel);

  for (const angel of targets) {
    const angelPath = angelIdToPath(angel.id);
    const mdPath = angelMdFile(cwd, angelPath === '.' ? '_root' : angelPath);

    if (isActiveAngel(mdPath) && !opts.force) {
      const confirmed = await promptOverwrite(angel.id);
      if (!confirmed) {
        console.log(`Skipping ${angel.id} (active, not overwriting).`);
        continue;
      }
    }

    console.log(`Onboarding ${angel.id}...`);

    const absoluteAngelPath = resolvePath(cwd, angelPath);
    const ctx = buildDiscoveryContext(absoluteAngelPath, opts.depth ?? 3);

    const timestamp = new Date().toISOString();
    const priorityContent = Object.entries(ctx.priorityFiles)
      .map(([file, content]) => `### ${file}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');

    const briefPath = writeBrief(cwd, {
      to: angel.id,
      from: 'main',
      timestamp,
      phase: 'discovery',
      type: 'change_request',
      task: 'Read this codebase territory and write your angel.md body. Cover: charter, public contract, invariants, dependencies, and open questions. Do not include frontmatter — the orchestrator adds it.',
      context: `${ctx.fileListing}\n\n## Priority Files\n\n${priorityContent || '(none found)'}`,
      expectedScope: 'angel.md only — do not modify source files',
      priorResponse: 'none',
    });

    const result = await invoke(cwd, {
      phase: 'discovery',
      angelId: angel.id,
      briefPath,
    });
    const body = result.response.proposedPlan.trim();

    if (!body || !/^##\s+(Charter|Public contract|Invariants)/m.test(body)) {
      throw new Error(
        `Angel ${angel.id} returned an empty or malformed angel.md body in PROPOSED PLAN. ` +
          `Response file: ${result.responsePath}. The angel likely wrote angel.md to the ` +
          `wrong path or misunderstood the PROPOSED PLAN field. Re-onboard once the prompt ` +
          `is fixed.`,
      );
    }

    const status = opts.autoActivate ? 'active' : 'draft';
    writeAngelMd(mdPath, {
      frontmatter: {
        status,
        last_updated: new Date().toISOString(),
        last_updated_by: 'main',
      },
      body,
    });

    printSummary(angel.id, status);
  }

  if (!opts.autoActivate) {
    printActivateHint();
  }
}

function ensureInit(cwd: string): Config {
  return loadConfig(cwd);
}

function selectAngels(
  registry: AngelRegistry,
  angelId: string | undefined,
): ReadonlyArray<AngelEntry> {
  if (angelId !== undefined) {
    return [registry.getById(angelId)];
  }
  return registry.listAll();
}

function isActiveAngel(mdPath: string): boolean {
  if (!fs.existsSync(mdPath)) return false;
  try {
    const { frontmatter } = readAngelMd(mdPath);
    return frontmatter.status === 'active';
  } catch {
    return false;
  }
}

async function promptOverwrite(angelId: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `Angel ${angelId} already has active context. Overwrite? (y/N) `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      },
    );
  });
}

function printSummary(angelId: string, status: string): void {
  console.log(`  ${angelId}: angel.md written (status: ${status})`);
}

function printActivateHint(): void {
  console.log('');
  console.log('Angels drafted. Review their angel.md files, then run:');
  console.log('  angels activate --all       to activate all draft angels');
  console.log('  angels activate <angel-id>  to activate a single angel');
}
