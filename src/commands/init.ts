import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { stringify as stringifyYaml } from 'yaml';
import { identifyCandidates, type FolderCandidate } from '../angels/identify.js';
import { detectExistingMemory } from '../angels/ingest.js';
import { writeAngelMd, type AngelMd } from '../angels/memory.js';
import { pickAdapter } from '../backend/factory.js';
import { DEFAULT_BACKEND_CMD, DEFAULT_TIMEOUT_SECONDS, DEFAULT_SWEEP_AUTONOMY } from '../config/defaults.js';
import type { Config, AngelEntry } from '../config/schema.js';
import {
  angelsRoot,
  configFile,
  newspaperFile,
  briefsDir,
  responsesDir,
  inboxDir,
  outboxDir,
  locksDir,
  logsDir,
  cursorsDir,
  archiveDir,
  angelMdFile,
} from '../paths/layout.js';
import { pathToAngelId } from '../paths/resolve.js';

export interface InitOptions {
  auto?: boolean;
  manual?: boolean;
}

/**
 * Bootstrap .angels/ in the current project.
 *
 * Interactive (default): walks the tree, shows candidates, lets user toggle.
 * --auto: accepts all heuristic candidates.
 * --manual: skips heuristics entirely; user manually enters folder paths.
 */
export async function initAngels(cwd: string, opts: InitOptions): Promise<void> {
  // Guard against re-initialization
  const cfgPath = configFile(cwd);
  if (fs.existsSync(cfgPath)) {
    throw new Error(
      `.angels/_config.yml already exists at ${cfgPath}\nProject is already initialized. Use "angels create <path>" to add new angels.`,
    );
  }

  if (opts.auto && opts.manual) {
    throw new Error('Cannot use both --auto and --manual flags at the same time.');
  }

  let chosenPaths: string[];

  if (opts.manual) {
    chosenPaths = await promptManualFolders(cwd);
  } else {
    const candidates = await identifyCandidates(cwd);

    if (opts.auto) {
      chosenPaths = candidates.map((c) => c.path);
      console.log(`Auto-accepting ${chosenPaths.length} candidate folder(s):`);
      for (const p of chosenPaths) {
        console.log(`  + ${p}`);
      }
    } else {
      chosenPaths = await promptInteractive(candidates);
    }
  }

  // Build the angel entries: always include _root, plus chosen folders
  const angelEntries: AngelEntry[] = [
    { id: '_root', type: 'root', path: '.' },
  ];

  for (const folderPath of chosenPaths) {
    const angelId = pathToAngelId(folderPath);
    angelEntries.push({ id: angelId, type: 'folder', path: folderPath });
  }

  // Create the .angels/ directory structure
  const root = angelsRoot(cwd);
  fs.mkdirSync(root, { recursive: true });

  const dirsToCreate = [
    briefsDir(cwd),
    responsesDir(cwd),
    inboxDir(cwd),
    outboxDir(cwd),
    locksDir(cwd),
    logsDir(cwd),
    cursorsDir(cwd),
    archiveDir(cwd),
  ];

  for (const dir of dirsToCreate) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Build and write _config.yml
  const config: Config = {
    version: 1,
    backend: {
      angel_cmd: DEFAULT_BACKEND_CMD,
      angel_timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
    },
    angels: angelEntries,
    sweep: {
      autonomy: DEFAULT_SWEEP_AUTONOMY,
    },
  };

  const yamlContent = stringifyYaml(config, { lineWidth: 0 });
  fs.writeFileSync(cfgPath, yamlContent, 'utf-8');
  console.log(`Created ${cfgPath}`);

  // Create empty _newspaper.md
  const newsPath = newspaperFile(cwd);
  fs.writeFileSync(newsPath, '', 'utf-8');
  console.log(`Created ${newsPath}`);

  // Create angel.md for each angel
  const now = new Date().toISOString();

  for (const entry of angelEntries) {
    const angelPath = entry.type === 'root' ? '_root' : entry.path;
    const mdPath = angelMdFile(cwd, angelPath);

    // Determine the actual folder in the project
    const projectFolder = entry.type === 'root' ? cwd : `${cwd}/${entry.path}`;

    // Check for existing memory files to ingest
    const memory = await detectExistingMemory(projectFolder, cwd);

    let body: string;
    if (memory.source !== null && memory.content !== null) {
      // Attempt ingestion via backend adapter
      console.log(`Ingesting ${memory.source} for ${entry.id}...`);
      body = await ingestWithBackend(config, entry, memory.content, memory.source, cwd);
    } else {
      body = generateBlankTemplate(entry);
    }

    const angelMd: AngelMd = {
      frontmatter: {
        status: 'draft',
        last_updated: now,
        last_updated_by: 'main',
      },
      body,
    };

    writeAngelMd(mdPath, angelMd);
    console.log(`Created ${mdPath}`);
  }

  console.log(`\nInitialized ${angelEntries.length} angel(s). Run "angels list" to see them.`);
}

function generateBlankTemplate(entry: AngelEntry): string {
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

async function ingestWithBackend(
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

async function promptInteractive(candidates: FolderCandidate[]): Promise<string[]> {
  if (candidates.length === 0) {
    console.log('No significant folder candidates found by heuristics.');
    console.log('Only the _root angel will be created.');
    return [];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });

  console.log('\nCandidate folders found by heuristics:\n');
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    console.log(`  [${i + 1}] ${c.path}  (${c.reason})`);
  }

  console.log('\nEnter the numbers of folders to include (comma-separated), "all" to accept all, or "none" to skip:');
  const input = await ask('> ');
  rl.close();

  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'all' || trimmed === 'a') {
    return candidates.map((c) => c.path);
  }

  if (trimmed === 'none' || trimmed === 'n' || trimmed === '') {
    return [];
  }

  const indices = trimmed.split(',').map((s) => s.trim());
  const selected: string[] = [];

  for (const idx of indices) {
    const num = parseInt(idx, 10);
    if (isNaN(num) || num < 1 || num > candidates.length) {
      console.warn(`Skipping invalid selection: "${idx}"`);
      continue;
    }
    selected.push(candidates[num - 1]!.path);
  }

  return selected;
}

async function promptManualFolders(cwd: string): Promise<string[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });

  console.log('\nManual mode: enter folder paths to register as angels (relative to project root).');
  console.log('Enter one path per line. Enter an empty line to finish.\n');

  const paths: string[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const input = await ask('folder> ');
    const trimmed = input.trim();

    if (trimmed === '') {
      break;
    }

    // Validate the folder exists
    const fullPath = `${cwd}/${trimmed}`;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) {
        console.warn(`  "${trimmed}" is not a directory, skipping.`);
        continue;
      }
    } catch {
      console.warn(`  "${trimmed}" does not exist, skipping.`);
      continue;
    }

    paths.push(trimmed);
    console.log(`  + ${trimmed}`);
  }

  rl.close();
  return paths;
}
