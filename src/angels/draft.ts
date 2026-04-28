import { detectExistingMemory } from './ingest.js';
import { writeAngelMd, type AngelMd } from './memory.js';
import { pickAdapter } from '../backend/factory.js';
import type { Config, AngelEntry } from '../config/schema.js';
import { angelMdFile } from '../paths/layout.js';
import { join } from 'node:path';

/**
 * Generate a blank angel.md body template for an angel entry.
 */
export function generateBlankTemplate(entry: AngelEntry): string {
  const title = entry.type === 'root'
    ? `Angel: . (root)`
    : `Angel: ${entry.path} (folder)`;

  return `# ${title}

## Charter
<!-- What this folder owns. What it does NOT own (with pointers to who does). -->

## Public contract
<!-- What this folder exposes to the rest of the codebase. -->

## Invariants
<!-- Rules that must never be violated. -->

## Decision log
<!-- Append-only. Each entry: date, decision, reason, alternatives rejected. -->

## Open questions / known debt
<!-- What's unresolved, what's deferred. -->

## Dependencies
<!-- Angels this folder depends on, and angels that depend on it. -->
`;
}

/**
 * Attempt to ingest an existing memory file (AGENTS.md or CLAUDE.md) via the
 * backend adapter. Falls back to a blank template if the backend fails.
 */
export async function ingestWithBackend(
  config: Config,
  entry: AngelEntry,
  memoryContent: string,
  source: string,
  cwd: string,
): Promise<string> {
  const prompt = buildIngestionPrompt(entry, memoryContent, source);

  try {
    const adapter = pickAdapter(config);
    const result = await adapter.invoke({
      prompt,
      cwd,
      timeoutMs: config.backend.angel_timeout_seconds * 1000,
    });

    if (result.code === 0 && result.stdout.trim().length > 0) {
      return result.stdout.trim() + '\n';
    }

    // Backend failed or returned empty — fall back to blank template
    console.warn(`  Backend returned exit code ${result.code} for ${entry.id}, using blank template.`);
    if (result.stderr.trim()) {
      console.warn(`  stderr: ${result.stderr.trim().split('\n')[0]}`);
    }
    return generateBlankTemplate(entry);
  } catch (err: unknown) {
    console.warn(
      `  Backend invocation failed for ${entry.id}: ${(err as Error).message}. Using blank template.`,
    );
    return generateBlankTemplate(entry);
  }
}

function buildIngestionPrompt(entry: AngelEntry, memoryContent: string, source: string): string {
  const pathDesc = entry.type === 'root' ? '. (project root)' : entry.path;
  return `You are generating an angel.md draft for the folder "${pathDesc}".

The folder already has an existing memory file (${source}) with the following content:

---
${memoryContent}
---

Based on this content, generate the body of an angel.md file (WITHOUT the YAML frontmatter — that is added separately). Use this exact template structure:

# Angel: ${pathDesc} (${entry.type})

## Charter
<Summarize what this folder owns based on the existing memory content>

## Public contract
<What this folder exposes to the rest of the codebase, extracted from the memory content>

## Invariants
<Rules that must never be violated, extracted from the memory content>

## Decision log
<Any decisions mentioned in the memory content, or leave a placeholder>

## Open questions / known debt
<Any open items from the memory content>

## Dependencies
<Any dependencies mentioned>

Output ONLY the markdown body. No frontmatter. No code fences wrapping the output.`;
}

/**
 * Create an angel.md draft for a single angel entry.
 * Handles ingestion of existing memory files and fallback to blank template.
 */
export async function createAngelDraft(
  config: Config,
  entry: AngelEntry,
  cwd: string,
): Promise<void> {
  const angelPath = entry.type === 'root' ? '_root' : entry.path;
  const mdPath = angelMdFile(cwd, angelPath);

  // Determine the actual folder in the project
  const projectFolder = entry.type === 'root' ? cwd : join(cwd, entry.path);

  // Check for existing memory files to ingest
  const memory = await detectExistingMemory(projectFolder, cwd);

  let body: string;
  if (memory.source !== null && memory.content !== null) {
    console.log(`Ingesting ${memory.source} for ${entry.id}...`);
    body = await ingestWithBackend(config, entry, memory.content, memory.source, cwd);
  } else {
    body = generateBlankTemplate(entry);
  }

  const angelMd: AngelMd = {
    frontmatter: {
      status: 'draft',
      last_updated: new Date().toISOString(),
      last_updated_by: 'main',
    },
    body,
  };

  writeAngelMd(mdPath, angelMd);
  console.log(`Created ${mdPath}`);
}
