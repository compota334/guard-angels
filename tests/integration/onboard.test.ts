import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execaNode } from 'execa';
import { resolve, join } from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { copyFakeBackend } from '../helpers/setup-project.js';
import { writeAngelMd } from '../../src/angels/memory.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist/bin/angels.js');

describe('angels onboard', () => {
  let tmpDir: string;
  let fakeBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-onboard-'));
    fakeBackendPath = copyFakeBackend(tmpDir);
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
    await execaNode(CLI_PATH, ['init', '--auto'], {
      cwd: tmpDir,
      nodeOptions: [],
      env: {
        ...process.env,
        GUARD_ANGELS_BACKEND_CMD: "bash " + fakeBackendPath,
      },
    });
  }

  it('creates draft angel.md for existing project with source files', async () => {
    buildSyntheticProject();
    await initProject();

    const result = await execaNode(CLI_PATH, ['onboard', '--angel', 'src-auth'], {
      cwd: tmpDir,
      nodeOptions: [],
    });

    expect(result.exitCode).toBe(0);

    const authMd = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');
    expect(fs.existsSync(authMd)).toBe(true);

    const content = fs.readFileSync(authMd, 'utf-8');
    expect(content).toContain('status: draft');
    expect(content).toContain('last_updated_by: main');

    // Body should be populated from the fake backend's PROPOSED PLAN
    const closeIdx = content.indexOf('\n---\n', 4);
    const body = content.slice(closeIdx + '\n---\n'.length).trim();
    expect(body.length).toBeGreaterThan(0);
  });

  it('--force overwrites active angel.md without prompting', async () => {
    buildSyntheticProject();
    await initProject();

    const authMd = join(tmpDir, '.angels', 'src', 'auth', 'angel.md');

    // Manually promote src-auth to active with distinctive body
    writeAngelMd(authMd, {
      frontmatter: {
        status: 'active',
        last_updated: '2026-01-01T00:00:00Z',
        last_updated_by: 'main',
      },
      body: '# Original body — should be replaced\n',
    });
    expect(fs.readFileSync(authMd, 'utf-8')).toContain('status: active');

    const result = await execaNode(
      CLI_PATH,
      ['onboard', '--angel', 'src-auth', '--force'],
      { cwd: tmpDir, nodeOptions: [] },
    );

    expect(result.exitCode).toBe(0);

    const updated = fs.readFileSync(authMd, 'utf-8');
    // After onboard (no --auto-activate), angel is reset to draft
    expect(updated).toContain('status: draft');
    // Original body should have been replaced
    expect(updated).not.toContain('# Original body — should be replaced');
  });

  it('fails with error when project is not initialized', async () => {
    // No init — tmpDir has no .angels/
    const result = await execaNode(CLI_PATH, ['onboard'], {
      cwd: tmpDir,
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toMatch(/angels init/i);
  });
});
