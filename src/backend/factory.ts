import { parseCommandString } from 'execa';
import type { Config } from '../config/schema.js';
import type { BackendAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { DroidAdapter } from './droid.js';
import { GenericAdapter } from './generic.js';

const KNOWN_ADAPTERS: Record<string, new (cmd: string, args: string[]) => BackendAdapter> = {
  claude: ClaudeAdapter,
  codex: CodexAdapter,
  droid: DroidAdapter,
};

export function pickAdapter(config: Config): BackendAdapter {
  const parts = parseCommandString(config.backend.angel_cmd);

  if (parts.length === 0) {
    throw new Error(
      `backend.angel_cmd is empty or could not be parsed: "${config.backend.angel_cmd}"`
    );
  }

  const cmd = parts[0]!;
  const args = parts.slice(1);

  const basename = cmd.includes('/') ? cmd.slice(cmd.lastIndexOf('/') + 1) : cmd;

  const AdapterClass = KNOWN_ADAPTERS[basename];
  if (AdapterClass) {
    return new AdapterClass(cmd, args);
  }

  return new GenericAdapter(cmd, args);
}
