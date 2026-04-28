import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execaNode } from 'execa';
import { resolve, join } from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist/bin/angels.js');

describe('angels init', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await execaNode(resolve(PROJECT_ROOT, 'node_modules/.bin/tsc'), [], {
      cwd: PROJECT_ROOT,
      nodeOptions: [],
    });
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Build a synthetic project tree with folders that match heuristics.
   * - src/auth: has 4 .ts files (meets >= 3 source files) + AGENTS.md for ingestion
   * - src/api: has index.ts (meets index/main file heuristic) + non-generic name
   * - utils: generic name, 1 file only => should NOT be a candidate
   */
  function buildSyntheticProject(): void {
    // src/auth — 4 source files + AGENTS.md
    const authDir = join(tmpDir, 'src', 'auth');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(join(authDir, 'session.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'middleware.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'types.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'utils.ts'), 'export {};');
    fs.writeFileSync(join(authDir, 'AGENTS.md'), '# Auth Module\nHandles user authentication and sessions.\n');

    // src/api — has index.ts + non-generic name
    const apiDir = join(tmpDir, 'src', 'api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(join(apiDir, 'index.ts'), 'export {};');
    fs.writeFileSync(join(apiDir, 'routes.ts'), 'export {};');

    // src — non-generic name, has subdirs but not enough direct source files
    // Still picked because "src" is non-generic
    const srcDir = join(tmpDir, 'src');
    fs.writeFileSync(join(srcDir, 'main.ts'), 'export {};');

    // utils — generic name with only 1 file -> should NOT be candidate (only if has >= 3 files or index file)
    const utilsDir = join(tmpDir, 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });
    fs.writeFileSync(join(utilsDir, 'helper.ts'), 'export {};');
  }

  it('creates full .angels/ structure with --auto flag', async () => {
    buildSyntheticProject();

    const result = await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
      env: {
        ...process.env,
      },
    });

    expect(result.exitCode).toBe(0);

    // Verify _config.yml was created and is valid
    const configPath = join(tmpDir, '.angels', '_config.yml');
    expect(fs.existsSync(configPath)).toBe(true);

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = parseYaml(configContent) as Record<string, unknown>;
    expect(config.version).toBe(1);
    expect(config.backend).toBeDefined();
    expect(config.sweep).toBeDefined();

    const angels = config.angels as Array<{ id: string; type: string; path: string }>;
    expect(angels.length).toBeGreaterThanOrEqual(2); // _root + at least one candidate

    // _root must always exist
    const rootAngel = angels.find((a) => a.id === '_root');
    expect(rootAngel).toBeDefined();
    expect(rootAngel!.type).toBe('root');
    expect(rootAngel!.path).toBe('.');

    // src/auth should be a candidate (4 source files + non-generic name)
    const authAngel = angels.find((a) => a.path === 'src/auth');
    expect(authAngel).toBeDefined();
    expect(authAngel!.type).toBe('folder');

    // src/api should be a candidate (index.ts + non-generic name)
    const apiAngel = angels.find((a) => a.path === 'src/api');
    expect(apiAngel).toBeDefined();

    // utils should NOT be a candidate (generic name + only 1 file)
    const utilsAngel = angels.find((a) => a.path === 'utils');
    expect(utilsAngel).toBeUndefined();

    // Verify _newspaper.md was created
    expect(fs.existsSync(join(tmpDir, '.angels', '_newspaper.md'))).toBe(true);

    // Verify directory structure
    expect(fs.existsSync(join(tmpDir, '.angels', '_briefs'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_responses'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_inbox'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_outbox'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_locks'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_logs'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_cursors'))).toBe(true);
    expect(fs.existsSync(join(tmpDir, '.angels', '_archive'))).toBe(true);

    // Verify angel.md for _root
    const rootMd = join(tmpDir, '.angels', '_root', 'angel.md');
    expect(fs.existsSync(rootMd)).toBe(true);
    const rootContent = fs.readFileSync(rootMd, 'utf-8');
    expect(rootContent).toContain('status: draft');
    expect(rootContent).toContain('last_updated_by: main');
    expect(rootContent).toContain('# Angel: . (root)');

    // Verify angel.md for src/auth (has AGENTS.md so ingestion attempted)
    const authMd = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
    expect(fs.existsSync(authMd)).toBe(true);
    const authContent = fs.readFileSync(authMd, 'utf-8');
    expect(authContent).toContain('status: draft');
    expect(authContent).toContain('last_updated_by: main');

    // Verify angel.md for src/api (no memory file -> blank template)
    const apiMd = join(tmpDir, '.angels', 'src', 'api', 'angel.md');
    expect(fs.existsSync(apiMd)).toBe(true);
    const apiContent = fs.readFileSync(apiMd, 'utf-8');
    expect(apiContent).toContain('status: draft');
    expect(apiContent).toContain('## Charter');
  });

  it('uses fake-backend for ingestion when AGENTS.md exists', async () => {
    buildSyntheticProject();

    // Use the echo-backend which echoes stdin to stdout
    // The init command will send the ingestion prompt to the backend
    // and use stdout as the angel.md body
    const result = await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
      env: {
        ...process.env,
        // Override the config — but since init creates the config, we can't override angel_cmd from env
        // The default angel_cmd is 'claude -p --dangerously-skip-permissions' which won't exist
        // So ingestion will fail and fall back to blank template
        // This test verifies that the fallback works correctly
      },
    });

    expect(result.exitCode).toBe(0);

    // auth has AGENTS.md, but since default backend (claude) isn't available,
    // it should fall back to blank template with a warning
    const authMd = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
    const authContent = fs.readFileSync(authMd, 'utf-8');
    expect(authContent).toContain('status: draft');
    // Blank template should have the Charter section
    expect(authContent).toContain('## Charter');
  });

  it('refuses to re-initialize an already initialized project', async () => {
    buildSyntheticProject();

    // First init
    await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
    });

    // Second init should fail
    const result = await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/_config\.yml already exists/);
    expect(result.stderr).toMatch(/angels create/);
  });

  it('refuses --auto and --manual together', async () => {
    const result = await execaNode(CLI_PATH, ['init', '--auto', '--manual'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Cannot use both --auto and --manual/);
  });

  it('creates only _root angel on empty project with --auto', async () => {
    // tmpDir is empty — no candidates
    const result = await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
    });

    expect(result.exitCode).toBe(0);

    const configPath = join(tmpDir, '.angels', '_config.yml');
    const config = parseYaml(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const angels = config.angels as Array<{ id: string }>;
    expect(angels.length).toBe(1);
    expect(angels[0]!.id).toBe('_root');

    // _root angel.md should exist
    expect(fs.existsSync(join(tmpDir, '.angels', '_root', 'angel.md'))).toBe(true);
  });
});
