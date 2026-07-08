import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { resolve as resolvePath } from 'node:path';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readAngelMd, writeAngelMd, verifyAngelMd, appendAngelMd, type AngelMd } from '../angels/memory.js';
import { angelMdFile } from '../paths/layout.js';
import { angelIdToPath } from '../paths/resolve.js';
import { buildDiscoveryContext } from '../protocol/discovery.js';
import { buildDeepDiscoveryContext } from '../protocol/discovery-enhanced.js';
import { buildDenseDiscoveryPrompt, buildChunkPrompt, shouldUseDenseTemplate } from '../protocol/prompt.js';
import { buildChunkPlan, estimateTotalTokens } from '../protocol/discovery-chunker.js';
import { invoke } from '../protocol/orchestrate.js';
import { writeBrief } from '../protocol/brief.js';
import { mapWithConcurrency, clampParallel } from '../util/concurrency.js';
import type { Config, AngelEntry } from '../config/schema.js';

export interface OnboardOptions {
  angel?: string;
  force?: boolean;
  autoActivate?: boolean;
  depth?: number;
  targetPct?: number;
  maxTokens?: number;
  parallel?: number;
}

export async function onboardAngels(cwd: string, opts: OnboardOptions): Promise<void> {
  const config = ensureInit(cwd);
  const registry = AngelRegistry.fromConfig(config);
  const targets = selectAngels(registry, opts.angel);

  // Resolve interactive overwrite confirmations BEFORE the parallel run —
  // readline prompts cannot interleave with concurrent onboards.
  const confirmed: AngelEntry[] = [];
  for (const angel of targets) {
    const mdPath = angelMdFile(cwd, angelIdToPath(angel.id));
    if (isActiveAngel(mdPath) && !opts.force) {
      const overwrite = await promptOverwrite(angel.id);
      if (!overwrite) {
        console.log(`Skipping ${angel.id} (active, not overwriting).`);
        continue;
      }
    }
    confirmed.push(angel);
  }

  const parallel = clampParallel(opts.parallel, 4);
  const results = await mapWithConcurrency(confirmed, parallel, (angel) =>
    onboardOne(cwd, angel, config, opts),
  );

  const failures = results
    .map((result, i) => ({ result, angel: confirmed[i] }))
    .filter((entry) => entry.result.status === 'rejected');

  for (const failure of failures) {
    const reason = (failure.result as PromiseRejectedResult).reason as Error;
    console.error(`Onboard failed for ${failure.angel.id}: ${reason?.message ?? String(reason)}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `Onboard failed for ${failures.length} of ${confirmed.length} angel(s): ` +
        failures.map((f) => f.angel.id).join(', '),
    );
  }

  if (!opts.autoActivate) {
    printActivateHint();
  }
}

/**
 * Onboard a single angel: pick the pipeline (dense direct write, chunked,
 * or legacy proposed-plan) based on the effective memory budget.
 */
async function onboardOne(
  cwd: string,
  angel: AngelEntry,
  config: Config,
  opts: OnboardOptions,
): Promise<void> {
  const angelPath = angelIdToPath(angel.id);
  const mdPath = angelMdFile(cwd, angelPath);

  console.log(`Onboarding ${angel.id}...`);

  // Detect whether to use dense direct write mode
  const angelConfigMemory = angel.memory ?? config.memory;
  const cliOverrides = opts.targetPct !== undefined || opts.maxTokens !== undefined;
  const effectiveMemory = cliOverrides
    ? { target_pct: opts.targetPct ?? angelConfigMemory?.target_pct ?? 25, max_tokens: opts.maxTokens ?? angelConfigMemory?.max_tokens }
    : angelConfigMemory;
  const useDense = shouldUseDenseTemplate(effectiveMemory);

  if (useDense) {
    // Check if chunking is needed (estimated >50KB)
    const absoluteAngelPath = resolvePath(cwd, angel.path);
    const contextWindow = 128_000;
    const deepContext = await buildDeepDiscoveryContext(absoluteAngelPath, effectiveMemory, contextWindow);
    const estimatedTok = estimateTotalTokens(deepContext);
    const useChunking = estimatedTok > 12_000; // >50KB threshold

    if (useChunking) {
      await onboardWithChunks(cwd, angel, config, opts, angelPath, mdPath, deepContext, estimatedTok);
    } else {
      await onboardWithDirectWrite(cwd, angel, config, opts, angelPath, mdPath);
    }
  } else {
    await onboardLegacy(cwd, angel, opts, angelPath, mdPath);
  }
}

async function onboardLegacy(
  cwd: string,
  angel: AngelEntry,
  opts: OnboardOptions,
  angelPath: string,
  mdPath: string,
): Promise<void> {
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

/**
 * Onboard an angel using the direct write flow:
 * 1. Build deep discovery context (dense mode)
 * 2. Build a dense discovery prompt
 * 3. Write a brief with the prompt as context
 * 4. Invoke the backend (the angel writes angel.md directly)
 * 5. Verify angel.md exists and is valid, then update frontmatter
 * 6. On failure, fall back to legacy onboard
 */
async function onboardWithDirectWrite(
  cwd: string,
  angel: AngelEntry,
  config: Config,
  opts: OnboardOptions,
  angelPath: string,
  mdPath: string,
): Promise<void> {
  // 1. Build deep discovery context
  const absoluteAngelPath = resolvePath(cwd, angel.path);
  const angelConfigMemory = angel.memory ?? config.memory;
  const cliOverrides = opts.targetPct !== undefined || opts.maxTokens !== undefined;
  const effectiveMemory = cliOverrides
    ? { target_pct: opts.targetPct ?? angelConfigMemory?.target_pct ?? 25, max_tokens: opts.maxTokens ?? angelConfigMemory?.max_tokens }
    : angelConfigMemory;
  const contextWindow = 128_000;
  const deepContext = await buildDeepDiscoveryContext(absoluteAngelPath, effectiveMemory, contextWindow);

  // 2. Build dense discovery prompt for the brief context
  const timestamp = new Date().toISOString();
  const prompt = buildDenseDiscoveryPrompt({
    angel,
    context: deepContext,
    memoryConfig: deepContext.memoryConfig,
    responsePath: '',
    writeMode: 'direct',
    angelMdPath: mdPath,
  });

  // 3. Write brief with the dense prompt as context
  const briefPath = writeBrief(cwd, {
    to: angel.id,
    from: 'main',
    timestamp,
    phase: 'discovery',
    type: 'change_request',
    task: 'Read this codebase territory and write your angel.md body. Cover: charter, public contract, invariants, dependencies, and open questions. Do not include frontmatter — the orchestrator adds it.',
    context: prompt,
    expectedScope: 'angel.md only — do not modify source files',
    priorResponse: 'none',
  });

  // 4. Invoke backend (orchestrate.ts handles WRITE_MODE: DIRECT detection)
  await invoke(cwd, {
    phase: 'discovery',
    angelId: angel.id,
    briefPath,
  });

  // 5. Check that the angel wrote the body file
  if (!fs.existsSync(mdPath)) {
    console.error(`Direct write failed: angel.md not found at ${mdPath}`);
    console.log(`Falling back to legacy onboard for ${angel.id}...`);
    await onboardLegacy(cwd, angel, opts, angelPath, mdPath);
    return;
  }

  const rawBody = fs.readFileSync(mdPath, 'utf-8').trim();

  // Angel was told to write body without frontmatter. If the content
  // starts with '---' the old file content (with frontmatter) is still
  // intact — the angel didn't actually write angel.md directly.
  if (rawBody.startsWith('---')) {
    console.error(`Direct write failed: angel.md at ${mdPath} still has old frontmatter — angel did not overwrite it`);
    console.log(`Falling back to legacy onboard for ${angel.id}...`);
    await onboardLegacy(cwd, angel, opts, angelPath, mdPath);
    return;
  }

  if (rawBody.length < 50) {
    console.error(`Direct write failed: angel.md body too short (${rawBody.length} chars)`);
    console.log(`Falling back to legacy onboard for ${angel.id}...`);
    await onboardLegacy(cwd, angel, opts, angelPath, mdPath);
    return;
  }

  // 6. Add frontmatter (the angel wrote only the body) and verify
  const status = opts.autoActivate ? 'active' : 'draft';
  writeAngelMd(mdPath, {
    frontmatter: {
      status,
      last_updated: new Date().toISOString(),
      last_updated_by: 'main',
    },
    body: rawBody,
  });

  // 7. Verify the final angel.md is well-formed
  const verification = verifyAngelMd(mdPath);
  if (!verification.valid) {
    console.error(`Direct write verification failed for ${angel.id}: ${verification.errors.join('; ')}`);
    console.log(`Falling back to legacy onboard for ${angel.id}...`);
    await onboardLegacy(cwd, angel, opts, angelPath, mdPath);
    return;
  }

  printSummary(angel.id, status);
}

/**
 * Onboard an angel using chunked writing for large territories (>50KB estimated).
 *
 * 1. Build chunk plan from deep context
 * 2. Write initial angel.md with just frontmatter (status: draft)
 * 3. For each chunk:
 *    a. Build chunk prompt
 *    b. Write brief and invoke backend
 *    c. Append chunk to angel.md
 * 4. Verify final file integrity
 */
async function onboardWithChunks(
  cwd: string,
  angel: AngelEntry,
  config: Config,
  opts: OnboardOptions,
  angelPath: string,
  mdPath: string,
  deepContext: Awaited<ReturnType<typeof buildDeepDiscoveryContext>>,
  estimatedTokens: number,
): Promise<void> {
  // 1. Build chunk plan
  const plan = buildChunkPlan(deepContext);

  // 2. If only 1 chunk, delegate to direct write
  if (plan.chunks.length === 1) {
    console.log(`  Estimated size ${estimatedTokens} tokens — within single-write threshold, using direct write.`);
    await onboardWithDirectWrite(cwd, angel, config, opts, angelPath, mdPath);
    return;
  }

  console.log(`  Territory estimated at ~${estimatedTokens} tokens — using chunked write (${plan.chunks.length} chunks).`);

  // 3. Write initial angel.md with only frontmatter (status: draft)
  writeAngelMd(mdPath, {
    frontmatter: {
      status: 'draft',
      last_updated: new Date().toISOString(),
      last_updated_by: 'main',
      memory_target_pct: deepContext.memoryConfig.targetPct,
      memory_max_tokens: deepContext.memoryConfig.maxTokens,
      territory_size: deepContext.fileCount,
    },
    body: '# Angel.md generated in chunks\n\n<!-- Content will be appended in sequential chunks -->\n',
  });

  // 4. Process each chunk sequentially
  let currentAngelMd: string | undefined;

  for (let i = 0; i < plan.chunks.length; i++) {
    const chunk = plan.chunks[i];
    const isFirst = i === 0;
    let attempts = 0;
    const maxRetries = 2;
    let success = false;

    while (attempts <= maxRetries && !success) {
      try {
        if (attempts > 0) {
          console.log(`  Retry ${attempts}/${maxRetries} for chunk ${i + 1}/${plan.chunks.length}...`);
        }

        // a. Read current angel.md content for context (chunks 1+)
        if (!isFirst) {
          try {
            const current = readAngelMd(mdPath);
            currentAngelMd = current.raw;
          } catch {
            currentAngelMd = undefined;
          }
        }

        // b. Build chunk prompt
        const prompt = buildChunkPrompt({
          angel,
          chunk,
          deepContext,
          existingAngelMd: currentAngelMd,
          chunkIndex: i,
          totalChunks: plan.chunks.length,
        });

        // c. Write brief with chunk prompt
        const timestamp = new Date().toISOString();
        const briefPath = writeBrief(cwd, {
          to: angel.id,
          from: 'main',
          timestamp,
          phase: 'discovery',
          type: 'change_request',
          task: isFirst
            ? `Write chunk ${i + 1}/${plan.chunks.length} of the angel.md. Generate sections: ${chunk.sections.join(', ')}.`
            : `Write chunk ${i + 1}/${plan.chunks.length} of the angel.md. Generate NEW sections: ${chunk.sections.join(', ')}. Do NOT repeat sections already written.`,
          context: prompt,
          expectedScope: 'angel.md only — do not modify source files',
          priorResponse: 'none',
        });

        // d. Invoke backend (capture the file size first so a direct write
        //    by the angel can be detected as growth)
        const sizeBefore = fs.statSync(mdPath).size;
        const result = await invoke(cwd, {
          phase: 'discovery',
          angelId: angel.id,
          briefPath,
        });

        // e. The angel responds with WRITE_MODE: CHUNK/CHUNK_FINAL.
        //    The angel should have written the chunk via appendAngelMd().
        //    We verify by checking the file was written correctly.

        // f. Append chunk to angel.md (in case the angel didn't do it)
        //    The chunk body is in proposedPlan field
        const bodyChunk = result.response.proposedPlan?.trim() ?? '';
        if (bodyChunk && bodyChunk.length > 50) {
          // appendAngelMd throws on failure; the surrounding retry loop catches it.
          const appendResult = appendAngelMd(angelPath, bodyChunk);
          console.log(`  Chunk ${i + 1}/${plan.chunks.length} appended (${appendResult.appendedChars} chars).`);
        } else {
          // The angel may have written directly — check if file grew
          const sizeAfter = fs.statSync(mdPath).size;
          if (sizeAfter <= sizeBefore) {
            throw new Error(`Chunk ${i + 1} produced no output`);
          }
          console.log(`  Chunk ${i + 1}/${plan.chunks.length} written directly by angel.`);
        }

        success = true;
      } catch (err: unknown) {
        attempts++;
        if (attempts > maxRetries) {
          console.error(`  Chunk ${i + 1} failed after ${maxRetries + 1} attempts: ${(err as Error).message}`);
          throw new Error(`Chunked write failed on chunk ${i + 1}/${plan.chunks.length}: ${(err as Error).message}`, { cause: err });
        }
        console.error(`  Chunk ${i + 1} attempt ${attempts} failed: ${(err as Error).message}. Retrying...`);
      }
    }
  }

  // 5. Verify integrity of the assembled angel.md
  console.log('  All chunks written. Verifying final angel.md...');

  // Read the complete file. A parse failure here means the chunked write
  // produced a corrupt angel.md — abort instead of silently overwriting the
  // assembled content with an empty body.
  let finalMd: AngelMd;
  try {
    finalMd = readAngelMd(mdPath);
  } catch (err: unknown) {
    throw new Error(
      `Chunked write completed but the assembled angel.md at ${mdPath} is unreadable: ` +
        `${(err as Error).message}. The file was left untouched for inspection.`,
      { cause: err },
    );
  }

  // Verify with expected min tokens
  const verification = verifyAngelMd(mdPath, Math.max(1000, Math.floor(estimatedTokens * 0.5)));

  if (!verification.valid) {
    console.error(`  Verification warnings: ${verification.errors.join('; ')}`);
    // Non-fatal: the angel.md may still be usable
  }

  // Update frontmatter to active
  const status = opts.autoActivate ? 'active' : 'draft';
  writeAngelMd(mdPath, {
    frontmatter: {
      status,
      last_updated: new Date().toISOString(),
      last_updated_by: 'main',
      memory_target_pct: deepContext.memoryConfig.targetPct,
      memory_max_tokens: deepContext.memoryConfig.maxTokens,
      territory_size: deepContext.fileCount,
      code_coverage_pct: Math.round(
        (deepContext.stats.highValueFiles / Math.max(deepContext.stats.totalFiles, 1)) * 100,
      ),
    },
    body: finalMd.body,
  });

  printSummary(angel.id, status);
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
