import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { stringify as stringifyYaml } from 'yaml';
import { identifyCandidates, type FolderCandidate } from '../angels/identify.js';
import { createAngelDraft } from '../angels/draft.js';
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
  for (const entry of angelEntries) {
    await createAngelDraft(config, entry, cwd);
  }

  console.log(`\nInitialized ${angelEntries.length} angel(s). Run "angels list" to see them.`);
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
