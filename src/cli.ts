import { Command } from 'commander';
import { listAngels } from './commands/list.js';

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
  .action(() => {
    console.error('not implemented: init');
    process.exit(1);
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
  .action(() => {
    console.error('not implemented: create');
    process.exit(1);
  });

program
  .command('brief')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<task>', 'Task description')
  .description('Phase 1: Write a brief, invoke angel in review mode')
  .action(() => {
    console.error('not implemented: brief');
    process.exit(1);
  });

program
  .command('execute')
  .argument('<angel-id>', 'Angel identifier')
  .argument('<brief>', 'Path to brief file')
  .description('Phase 2: Re-invoke angel with approval in execute mode')
  .action(() => {
    console.error('not implemented: execute');
    process.exit(1);
  });

program
  .command('cable')
  .argument('<to>', 'Target angel identifier')
  .argument('<type>', 'Cable type')
  .argument('<body>', 'Cable message body')
  .description('Manually send a cable to an angel')
  .action(() => {
    console.error('not implemented: cable');
    process.exit(1);
  });

program
  .command('inbox')
  .argument('<angel-id>', 'Angel identifier')
  .description('Show pending cables for an angel')
  .action(() => {
    console.error('not implemented: inbox');
    process.exit(1);
  });

program
  .command('newspaper')
  .description('Print recent newspaper entries')
  .option('--since <iso>', 'Only show entries since this ISO timestamp')
  .action(() => {
    console.error('not implemented: newspaper');
    process.exit(1);
  });

program
  .command('sweep')
  .description('Wake every angel in maintenance mode (report-only in v1)')
  .option('--since <ref>', 'Git commit or ISO timestamp to scope the sweep')
  .action(() => {
    console.error('not implemented: sweep');
    process.exit(1);
  });

program
  .command('doctor')
  .description('Sanity check: orphaned angels, missing angels, stale locks')
  .option('--archive', 'Archive old briefs/responses/logs')
  .option('--older-than <days>', 'Archive threshold in days (default: 30)')
  .action(() => {
    console.error('not implemented: doctor');
    process.exit(1);
  });

export { program };
