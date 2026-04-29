import { Command } from 'commander';
import { initAngels } from './commands/init.js';
import { listAngels } from './commands/list.js';
import { createAngel } from './commands/create.js';
import { briefAngel } from './commands/brief.js';
import { executeAngel } from './commands/execute.js';
import { sendCable } from './commands/cable.js';
import { showInbox } from './commands/inbox.js';
import { showNewspaper } from './commands/newspaper.js';
import { sweepAngels } from './commands/sweep.js';
import { runDoctor } from './commands/doctor.js';

const program = new Command();

program
  .name('angels')
  .description('CLI orchestrator that creates per-folder angel agents for persistent codebase context')
  .version('0.1.0');

program
  .command('init')
  .description('Bootstrap .angels/ in current project')
  .option('--auto', 'Accept all heuristic candidates')
  .option('--manual', 'Skip heuristics entirely')
  .action(async (options: { auto?: boolean; manual?: boolean }) => {
    try {
      await initAngels(process.cwd(), options);
    } catch (err: unknown) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all registered angels')
  .action(() => {
    try {
      listAngels(process.cwd());
    } catch (err: unknown) {
      console.error((err as Error).message);
      process.exit(1);
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
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('brief')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<task>', 'Task description')
  .description('Phase 1: Write a brief, invoke angel in review mode')
  .action(async (angelId: string, task: string) => {
    try {
      const exitCode = await briefAngel(process.cwd(), angelId, task);
      process.exit(exitCode);
    } catch (err: unknown) {
      console.error((err as Error).message);
      process.exit(3);
    }
  });

program
  .command('execute')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<brief>', 'Path to brief file')
  .description('Phase 2: Re-invoke angel with approval in execute mode')
  .action(async (angelId: string, briefPath: string) => {
    try {
      const exitCode = await executeAngel(process.cwd(), angelId, briefPath);
      process.exit(exitCode);
    } catch (err: unknown) {
      console.error((err as Error).message);
      process.exit(1);
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
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('inbox')
  .argument('<angel-id>', 'Angel identifier')
  .description('Show pending cables for an angel')
  .action((angelId: string) => {
    try {
      showInbox(process.cwd(), angelId);
    } catch (err: unknown) {
      console.error((err as Error).message);
      process.exit(1);
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
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('sweep')
  .description('Wake every angel in maintenance mode (report-only in v1)')
  .option('--since <ref>', 'ISO timestamp to scope the newspaper delta')
  .action(async (options: { since?: string }) => {
    try {
      const exitCode = await sweepAngels(process.cwd(), options);
      process.exit(exitCode);
    } catch (err: unknown) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Sanity check: orphaned angels, missing angels, stale locks')
  .option('--archive', 'Archive old briefs/responses/logs')
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
      console.error((err as Error).message);
      process.exit(1);
    }
  });

export { program };
