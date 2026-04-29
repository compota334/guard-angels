import { execaNode } from 'execa';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

export async function setup(): Promise<void> {
  await execaNode(resolve(PROJECT_ROOT, 'node_modules/.bin/tsc'), [], {
    cwd: PROJECT_ROOT,
    nodeOptions: [],
  });
}
