import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execaNode } from 'execa';
import { resolve, join } from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist/bin/angels.js');

describe('angels activate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-activate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildSyntheticProject(): void {
    const authDir = join(tmpDir, 'src', 'auth');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(join(authDir, 'session.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'middleware.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'types.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'utils.ts'), 'export {};');
  }

  async function initProject(): Promise<void> {
    // No backend needed — synthetic project has no AGENTS.md, so init uses blank templates
    await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
    });
  }

  function readStatus(mdPath: string): string {
    const content = fs.readFileSync(mdPath, 'utf-8');
    const m = content.match(/^status:\s*(\w+)/m);
    return m ? m[1]! : '';
  }

  it('promotes a single draft angel to active', async () => {
    buildSyntheticProject();
    await initProject();

    const authMd = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
    expect(readStatus(authMd)).toBe('draft');

    const result = await execaNode(CLI_PATH, ['activate', 'src-auth'], {
      cwd: tmpDir,
      nodeOptions: [],
    });

    expect(result.exitCode).toBe(0);
    expect(readStatus(authMd)).toBe('active');
    expect(result.stdout).toContain('src-auth');
    expect(result.stdout).toContain('activated');
  });

  it('--all promotes all draft angels to active', async () => {
    buildSyntheticProject();
    await initProject();

    // Read config to enumerate all registered angels
    const configRaw = fs.readFileSync(join(tmpDir, '.angels', '_config.yml'), 'utf-8');
    const config = parseYaml(configRaw) as {
      angels: Array<{ id: string; type: string; path: string }>;
    };

    // Verify every angel starts as draft
    for (const angel of config.angels) {
      const subdir = angel.type === 'root' ? '_root' : angel.path;
      const mdPath = join(tmpDir, '.angels', subdir, 'angel.md');
      expect(readStatus(mdPath)).toBe('draft');
    }

    const result = await execaNode(CLI_PATH, ['activate', '--all'], {
      cwd: tmpDir,
      nodeOptions: [],
    });

    expect(result.exitCode).toBe(0);

    // Every angel should now be active
    for (const angel of config.angels) {
      const subdir = angel.type === 'root' ? '_root' : angel.path;
      const mdPath = join(tmpDir, '.angels', subdir, 'angel.md');
      expect(readStatus(mdPath)).toBe('active');
    }
  });
});
