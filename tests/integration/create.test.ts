import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execaNode } from 'execa';
import { resolve, join } from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist/bin/angels.js');

describe('angels create', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await execaNode(resolve(PROJECT_ROOT, 'node_modules/.bin/tsc'), [], {
      cwd: PROJECT_ROOT,
      nodeOptions: [],
    });
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-create-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Initialize a project with --auto so we have a valid .angels/ structure.
   */
  async function initProject(): Promise<void> {
    // Create a minimal project structure
    fs.mkdirSync(join(tmpDir, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(join(tmpDir, 'src', 'auth', 'session.ts'), 'export {};');
    fs.writeFileSync(join(tmpDir, 'src', 'auth', 'middleware.ts'), 'export {};');
    fs.writeFileSync(join(tmpDir, 'src', 'auth', 'types.ts'), 'export {};');

    fs.mkdirSync(join(tmpDir, 'src', 'api'), { recursive: true });
    fs.writeFileSync(join(tmpDir, 'src', 'api', 'index.ts'), 'export {};');

    // Init with --auto (folders created AFTER init won't be auto-detected)
    await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
    });
  }

  it('creates a new angel for an existing folder', async () => {
    await initProject();

    // Create a new folder AFTER init so it's not auto-detected
    fs.mkdirSync(join(tmpDir, 'src', 'payments'), { recursive: true });
    fs.writeFileSync(join(tmpDir, 'src', 'payments', 'stripe.ts'), 'export {};');

    const result = await execaNode(CLI_PATH, ['create', 'src/payments'], {
      cwd: tmpDir,
      nodeOptions: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src-payments');
    expect(result.stdout).toContain('src/payments');

    // Verify angel.md was created
    const angelMd = join(tmpDir, '.angels', 'src', 'payments', 'angel.md');
    expect(fs.existsSync(angelMd)).toBe(true);
    const content = fs.readFileSync(angelMd, 'utf-8');
    expect(content).toContain('status: draft');
    expect(content).toContain('last_updated_by: main');
    expect(content).toContain('## Charter');

    // Verify _config.yml was updated
    const configPath = join(tmpDir, '.angels', '_config.yml');
    const config = parseYaml(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const angels = config.angels as Array<{ id: string; type: string; path: string }>;
    const payments = angels.find((a) => a.id === 'src-payments');
    expect(payments).toBeDefined();
    expect(payments!.type).toBe('folder');
    expect(payments!.path).toBe('src/payments');
  });

  it('refuses to create an angel for a duplicate path', async () => {
    await initProject();

    // src/auth was already registered by init --auto
    const result = await execaNode(CLI_PATH, ['create', 'src/auth'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/);
  });

  it('refuses to create an angel for a non-existent path', async () => {
    await initProject();

    const result = await execaNode(CLI_PATH, ['create', 'src/nonexistent'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/does not exist/);
  });

  it('refuses to create an angel for a path outside project root', async () => {
    await initProject();

    const result = await execaNode(CLI_PATH, ['create', '../outside'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/outside the project root/);
  });

  it('refuses to create an angel for the project root', async () => {
    await initProject();

    const result = await execaNode(CLI_PATH, ['create', '.'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/root/i);
  });

  it('fails when project is not initialized', async () => {
    // No init, just an empty dir
    const result = await execaNode(CLI_PATH, ['create', 'src'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Config file not found|angels init/);
  });
});
