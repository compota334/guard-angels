import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { readInbox } from '../messaging/cables.js';

/**
 * Pretty-print pending cables for an angel.
 *
 * Validates the angel exists in the registry before reading.
 * Prints each cable with timestamp, sender, type, urgency, subject,
 * and body. If no cables are pending, prints a clean "no pending cables"
 * message.
 */
export function showInbox(cwd: string, angelId: string): void {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);

  // Validate angel exists
  registry.getById(angelId); // throws if not found

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
}
