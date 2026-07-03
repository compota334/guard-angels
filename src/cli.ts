import { Command } from 'commander';
import { CLI_VERSION } from './version.js';
import { initAngels } from './commands/init.js';
import { onboardAngels } from './commands/onboard.js';
import { activateAngels } from './commands/activate.js';
import { listAngels } from './commands/list.js';
import { createAngel } from './commands/create.js';
import { briefAngel } from './commands/brief.js';
import { executeAngel } from './commands/execute.js';
import { doAngel } from './commands/do.js';
import { sendCable } from './commands/cable.js';
import { showInbox } from './commands/inbox.js';
import { showNewspaper } from './commands/newspaper.js';
import { sweepAngels } from './commands/sweep.js';
import { runDoctor } from './commands/doctor.js';
import { retireAngel } from './commands/retire.js';
import { showAngel } from './commands/show.js';
import { askAngel } from './commands/ask.js';
import { chatWithAngel } from './commands/chat.js';
import { generateCompletion } from './commands/completion.js';

const program = new Command();

program
  .name('angels')
  .description('CLI orchestrator that creates per-folder angel agents for persistent codebase context')
  .version(CLI_VERSION)
  .option('--verbose', 'Enable stack traces and debug output on errors');

/**
 * Format an error for CLI output.
 *
 * In normal mode: prints only the message.
 * In verbose mode: prints the full error chain with stack traces.
 */
function formatError(err: unknown): string {
  const verbose = program.opts().verbose === true;

  if (!(err instanceof Error)) {
    return String(err);
  }

  if (!verbose) {
    return err.message;
  }

  const lines: string[] = [];
  let current: Error | undefined = err;
  let depth = 0;

  while (current) {
    const prefix = depth === 0 ? 'Error' : `Caused by`;
    lines.push(`${prefix}: ${current.message}`);
    if (current.stack) {
      // Extract just the stack frames (lines starting with "    at")
      const frames = current.stack
        .split('\n')
        .filter((line) => line.trimStart().startsWith('at '));
      if (frames.length > 0) {
        lines.push(...frames);
      }
    }
    current = current.cause instanceof Error ? current.cause : undefined;
    depth++;
  }

  return lines.join('\n');
}

/**
 * Handle a caught error: format it and exit with the given code.
 */
function handleError(err: unknown, exitCode: number): never {
  console.error(formatError(err));
  process.exit(exitCode);
}

program
  .command('init')
  .description('Bootstrap .angels/ in current project')
  .option('--auto', 'Accept all heuristic candidates')
  .option('--manual', 'Skip heuristics entirely')
  .action(async (options: { auto?: boolean; manual?: boolean }) => {
    try {
      await initAngels(process.cwd(), options);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('onboard')
  .description('Bootstrap angel context from existing codebase')
  .option('--angel <id>', 'Onboard only this angel')
  .option('--force', 'Overwrite active angel.md without prompting')
  .option('--auto-activate', 'Set status=active immediately (skip draft review)')
  .option('--depth <n>', 'Recursion depth for file listing (default: 3)')
  .option('--target-pct <n>', 'Memory target percentage for angel.md density (1-100, overrides config)')
  .option('--max-tokens <n>', 'Max tokens for angel.md (overrides config)')
  .action(async (options: { angel?: string; force?: boolean; autoActivate?: boolean; depth?: string; targetPct?: string; maxTokens?: string }) => {
    try {
      const depth =
        options.depth !== undefined ? parseInt(options.depth, 10) : 3;
      if (isNaN(depth) || depth < 1) {
        console.error(
          `Invalid --depth value: "${options.depth}". Must be a positive integer.`,
        );
        process.exit(1);
        return;
      }
      const targetPct =
        options.targetPct !== undefined ? parseInt(options.targetPct, 10) : undefined;
      const maxTokens =
        options.maxTokens !== undefined ? parseInt(options.maxTokens, 10) : undefined;
      await onboardAngels(process.cwd(), {
        angel: options.angel,
        force: options.force,
        autoActivate: options.autoActivate,
        depth,
        targetPct,
        maxTokens,
      });
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('activate')
  .argument('[angel-id]', 'Angel identifier')
  .description('Promote draft angel(s) to active')
  .option('--all', 'Activate all draft angels')
  .action(async (angelId: string | undefined, options: { all?: boolean }) => {
    try {
      await activateAngels(process.cwd(), angelId, options);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('list')
  .description('List all registered angels')
  .action(() => {
    try {
      listAngels(process.cwd());
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('create')
  .argument('<path>', 'Folder path to create an angel for')
  .description('Create an angel for a specific folder')
  .action(async (folderPath: string) => {
    try {
      await createAngel(process.cwd(), folderPath);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('brief')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<task>', 'Task description')
  .description('Phase 1: Write a brief, invoke angel in review mode')
  .option('--consume-cables', 'Inject pending inbox cables as context and archive them after')
  .action(async (angelId: string, task: string, options: { consumeCables?: boolean }) => {
    try {
      const exitCode = await briefAngel(process.cwd(), angelId, task, {
        consumeCables: options.consumeCables,
      });
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 3);
    }
  });

program
  .command('execute')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<brief>', 'Path to brief file')
  .description('Phase 2: Re-invoke angel with approval in execute mode')
  .option('--strict-territory', 'Block and rollback out-of-territory writes instead of warning')
  .action(async (angelId: string, briefPath: string, options: { strictTerritory?: boolean }) => {
    try {
      const exitCode = await executeAngel(process.cwd(), angelId, briefPath, {
        strictTerritory: options.strictTerritory,
      });
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('do')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<task>', 'Task description')
  .description('Brief angel (review) then auto-execute if approved; exit 1/2 on concerns/refuse')
  .action(async (angelId: string, task: string) => {
    try {
      const exitCode = await doAngel(process.cwd(), angelId, task);
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 3);
    }
  });

program
  .command('cable')
  .argument('<to>', 'Target angel identifier')
  .argument('<type>', 'Cable type (breaking_change, fyi, review_request, invariant_violation)')
  .argument('<body>', 'Cable message body')
  .option('--urgency <level>', 'Urgency level: high, normal, low (default: normal)')
  .option('--subject <text>', 'Subject line (defaults to first 60 chars of body)')
  .option('--from <angel-id>', 'Sender angel-id (default: _root)')
  .description('Manually send a cable to an angel')
  .action((to: string, type: string, body: string, options: { urgency?: string; subject?: string; from?: string }) => {
    try {
      sendCable(process.cwd(), to, type, body, options);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('inbox')
  .argument('<angel-id>', 'Angel identifier')
  .description('Show pending cables for an angel')
  .option('--ack', 'Archive displayed cables after showing them')
  .action((angelId: string, options: { ack?: boolean }) => {
    try {
      showInbox(process.cwd(), angelId, { ack: options.ack });
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('newspaper')
  .description('Print recent newspaper entries')
  .option('--since <iso>', 'Only show entries since this ISO timestamp')
  .action((options: { since?: string }) => {
    try {
      showNewspaper(process.cwd(), options);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('sweep')
  .description('Wake every angel in maintenance mode (report-only in v1)')
  .option('--since <ref>', 'ISO timestamp to scope the newspaper delta')
  .option('--timeout <seconds>', 'Per-angel timeout in seconds (overrides config default)')
  .option('--angel <id>', 'Sweep only this angel (by ID)')
  .action(async (options: { since?: string; timeout?: string; angel?: string }) => {
    try {
      let timeoutSeconds: number | undefined;
      if (options.timeout !== undefined) {
        timeoutSeconds = parseInt(options.timeout, 10);
        if (isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
          console.error(`Invalid --timeout value: "${options.timeout}". Must be a positive integer.`);
          process.exit(1);
          return;
        }
      }
      const exitCode = await sweepAngels(process.cwd(), { since: options.since, timeoutSeconds, angel: options.angel });
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('retire')
  .argument('<angel-id>', 'Angel identifier to retire')
  .description('Archive and remove an angel from the project')
  .action(async (angelId: string) => {
    try {
      const exitCode = await retireAngel(process.cwd(), angelId);
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('ask')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<question>', 'Question to ask the angel')
  .description('Ask an angel a read-only question (no brief file, no execute path)')
  .action(async (angelId: string, question: string) => {
    try {
      const exitCode = await askAngel(process.cwd(), angelId, question);
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('chat')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<message>', 'Note to append to angel chat history')
  .description('Append a note to angel chat history (no invocation)')
  .action((angelId: string, message: string) => {
    try {
      chatWithAngel(process.cwd(), angelId, message);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('show')
  .argument('<angel-id>', 'Angel identifier')
  .description('Show the current angel.md for an angel')
  .action((angelId: string) => {
    try {
      showAngel(process.cwd(), angelId);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('doctor')
  .description('Sanity check: orphaned angels, missing angels, stale locks')
  .option('--archive', 'Archive old briefs/responses/logs/outbox and quarantined inbox cables')
  .option('--older-than <days>', 'Archive threshold in days (default: 30)')
  .action(async (options: { archive?: boolean; olderThan?: string }) => {
    try {
      const olderThanDays = options.olderThan !== undefined ? parseInt(options.olderThan, 10) : undefined;
      if (olderThanDays !== undefined && (isNaN(olderThanDays) || olderThanDays < 0)) {
        console.error(`Invalid --older-than value: "${options.olderThan}". Must be a non-negative integer.`);
        process.exit(1);
        return;
      }
      const exitCode = await runDoctor(process.cwd(), {
        archive: options.archive,
        olderThanDays,
      });
      process.exit(exitCode);
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

program
  .command('completion')
  .argument('<shell>', 'Shell type: bash or zsh')
  .description('Print a shell completion script for the angels command')
  .action((shell: string) => {
    try {
      const commands = program.commands
        .map((cmd) => ({ name: cmd.name(), description: cmd.description() }))
        .filter((cmd) => cmd.name !== 'help');
      process.stdout.write(generateCompletion(shell, commands));
    } catch (err: unknown) {
      handleError(err, 1);
    }
  });

export { program };
