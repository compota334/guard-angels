import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { writeCable, type CableType, type CableUrgency } from '../messaging/cables.js';
import { appendNewspaper } from '../messaging/newspaper.js';

const VALID_TYPES = new Set<string>([
  'breaking_change',
  'fyi',
  'review_request',
  'invariant_violation',
]);

/**
 * Manually send a cable to an angel.
 *
 * Validates that both the sender (_root by default, since this is invoked
 * by the main agent) and the recipient exist in the registry.
 *
 * Options:
 * - urgency: 'high' | 'normal' | 'low' (default: 'normal')
 * - subject: optional subject line (defaults to first 60 chars of body)
 * - from: sender angel-id (default: '_root')
 */
export function sendCable(
  cwd: string,
  to: string,
  type: string,
  body: string,
  opts: {
    urgency?: string;
    subject?: string;
    from?: string;
  } = {},
): void {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);

  const fromId = opts.from ?? '_root';

  // Validate sender and recipient exist
  registry.getById(fromId); // throws if not found
  registry.getById(to); // throws if not found

  // Validate cable type
  if (!VALID_TYPES.has(type)) {
    throw new Error(
      `Invalid cable type: "${type}". Must be one of: ${[...VALID_TYPES].join(', ')}`,
    );
  }

  // Validate urgency if provided
  const urgency = (opts.urgency ?? 'normal') as CableUrgency;
  const validUrgencies = new Set(['high', 'normal', 'low']);
  if (!validUrgencies.has(urgency)) {
    throw new Error(
      `Invalid urgency: "${urgency}". Must be one of: high, normal, low`,
    );
  }

  // Build subject from body if not explicitly provided
  const subject = opts.subject ?? body.slice(0, 60).replace(/\n/g, ' ').trim();

  const timestamp = new Date().toISOString();

  const filename = writeCable(cwd, {
    from: fromId,
    to,
    timestamp,
    type: type as CableType,
    urgency,
    subject,
    requiresAck: urgency === 'high',
    body,
    references: [],
  });

  appendNewspaper(cwd, {
    timestamp,
    angelId: fromId,
    summary: `CABLE sent to ${to} [${type}/${urgency}]: ${subject}`,
  });

  console.log(`Cable sent: ${filename}`);
  console.log(`  FROM: ${fromId} → TO: ${to}`);
  console.log(`  TYPE: ${type}  URGENCY: ${urgency}`);
  console.log(`  SUBJECT: ${subject}`);
}
