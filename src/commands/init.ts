import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { identifyCandidates, type FolderCandidate } from '../angels/identify.js';
import { createAngelDraft } from '../angels/draft.js';
import { DEFAULT_BACKEND_CMD, DEFAULT_TIMEOUT_SECONDS, DEFAULT_SWEEP_AUTONOMY } from '../config/defaults.js';
import { loadConfig } from '../config/load.js';
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
  // Guard against re-initialization, with recovery mode for missing angel.md files
  const cfgPath = configFile(cwd);
  if (fs.existsSync(cfgPath)) {
    const existingConfig = loadConfig(cwd);
    const missingEntries: AngelEntry[] = [];
    for (const entry of existingConfig.angels) {
      if (!fs.existsSync(angelMdFile(cwd, entry.path))) {
        missingEntries.push(entry);
      }
    }
    if (missingEntries.length === 0) {
      throw new Error(
        `.angels/_config.yml already exists at ${cfgPath}\nProject is already initialized. Use "angels create <path>" to add new angels.`,
      );
    }
    console.log(`Recovery mode: ${missingEntries.length} angel(s) missing angel.md. Recreating drafts...`);
    for (const entry of missingEntries) {
      await createAngelDraft(existingConfig, entry, cwd);
    }
    console.log('\nRecovery complete.');
    return;
  }

  if (opts.auto && opts.manual) {
    throw new Error('Cannot use both --auto and --manual flags at the same time.');
  }

  let chosenPaths: string[];
  let hasSourceFolders = false;

  if (opts.manual) {
    chosenPaths = await promptManualFolders(cwd);
  } else {
    const candidates = await identifyCandidates(cwd);
    hasSourceFolders = candidates.length > 0;

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

  fs.writeFileSync(
    join(root, '.gitignore'),
    [
      '# Generated per-run — do not track',
      '_briefs/',
      '_responses/',
      '_inbox/',
      '_outbox/',
      '_logs/',
      '_cursors/',
      '_locks/',
      '_archive/',
    ].join('\n') + '\n',
    'utf-8',
  );
  console.log(`Created ${join(root, '.gitignore')}`);

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
    memory: { target_pct: 25 },
  };

  const yamlContent = stringifyYaml(config, { lineWidth: 0 });
  fs.writeFileSync(cfgPath, yamlContent, 'utf-8');
  console.log(`Created ${cfgPath}`);

  // Create empty _newspaper.md
  const newsPath = newspaperFile(cwd);
  fs.writeFileSync(newsPath, '', 'utf-8');
  console.log(`Created ${newsPath}`);

  if (hasSourceFolders) {
    console.log('\nTip: this looks like an existing project.');
    console.log('Run "angels onboard" to bootstrap angel context from your code.');
  }

  // Create angel.md for each angel
  for (const entry of angelEntries) {
    await createAngelDraft(config, entry, cwd);
  }

  // Write AGENTS.md to project root if not already present
  const agentsMdPath = join(cwd, 'AGENTS.md');
  if (fs.existsSync(agentsMdPath)) {
    const existing = fs.readFileSync(agentsMdPath, 'utf-8');
    if (!existing.includes('Guard Angels') && !existing.includes('angels brief')) {
      console.log(
        'AGENTS.md already exists. Add Guard Angels orchestrator rules manually from README Main-agent prompt addendum.',
      );
    }
  } else {
    fs.writeFileSync(
      agentsMdPath,
      [
        '# Guard Angels - orchestrator rules',
        '',
        'This project uses Guard Angels. Significant folders have angels that own',
        'their territory. Manual edits inside an angel\'s territory are FORBIDDEN.',
        'They will leave angel.md stale, skip cable emission, and break the audit',
        'trail (newspaper, FILES CHANGED record).',
        '',
        'Before editing any code:',
        '',
        '1. Check angels list to see which folders have angels.',
        '2. For changes inside an angel\'s folder: do NOT edit directly. Use',
        '   angels brief <angel-id> "<task>" to delegate. Review the response.',
        '   If the angel proceeds, run angels execute <angel-id> <brief-path>.',
        '   If the angel raises concerns, address them before executing.',
        '3. Even if the plan seems deterministic or mechanical, you MUST use',
        '   angels execute. The angel\'s role is not just review - it also writes',
        '   its own memory updates. Bypassing execute corrupts the project\'s',
        '   institutional knowledge.',
        '4. For changes spanning multiple folders: brief each affected angel',
        '   sequentially.',
        '5. After a batch of changes: run angels sweep.',
        '6. Read angels newspaper regularly.',
        '',
        'The angel.md files are authoritative documentation - read them before',
        'asking the user about folder-level decisions.',
      ].join('\n') + '\n',
      'utf-8',
    );
    console.log(`Created ${agentsMdPath}`);
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
