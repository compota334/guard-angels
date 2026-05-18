import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readInbox, archiveProcessedInbox } from '../messaging/cables.js';

export interface ShowInboxOptions {
  ack?: boolean;
}

/**
 * Pretty-print pending cables for an angel.
 *
 * For angelId 'main', skips registry validation (main is the orchestrator,
 * not a registered angel). For all other angels, validates existence first.
 * With ack=true, archives all displayed cables after printing.
 */
export function showInbox(cwd: string, angelId: string, options: ShowInboxOptions = {}): void {
  if (angelId !== 'main') {
    const config = loadConfig(cwd);
    const registry = AngelRegistry.fromConfig(config);
    registry.getById(angelId); // throws if not found
  }

  const cables = readInbox(cwd, angelId);

  if (cables.length === 0) {
    console.log(`No pending cables for angel "${angelId}".`);
    return;
  }

  console.log(`Pending cables for angel "${angelId}" (${cables.length}):`);
  console.log('');

  for (const cable of cables) {
    const urgencyTag =
      cable.urgency === 'high' ? '[HIGH]' :
      cable.urgency === 'low' ? '[low]' :
      '';
    const prefix = urgencyTag ? `${urgencyTag} ` : '';

    console.log(`  ${prefix}${cable.subject}`);
    console.log(`    From: ${cable.from}  Type: ${cable.type}  Time: ${cable.timestamp}`);
    if (cable.requiresAck) {
      console.log('    Requires acknowledgment: yes');
    }
    console.log(`    Body: ${cable.body.split('\n')[0]}`);
    if (cable.references.length > 0) {
      console.log(`    References: ${cable.references.join(', ')}`);
    }
    console.log('');
  }

  if (options.ack) {
    archiveProcessedInbox(cwd, angelId);
    console.log(`${cables.length} cable(s) archived.`);
  }
}
