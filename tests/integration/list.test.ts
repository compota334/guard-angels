import { describe, it, expect } from 'vitest';
import { execaNode } from 'execa';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist/bin/angels.js');
const FIXTURE_PROJECT = resolve(PROJECT_ROOT, 'tests/fixtures/projects/sample');

describe('angels list', () => {

  it('prints a formatted table of all registered angels with status', async () => {
    const result = await execaNode(CLI_PATH, ['list'], {
      cwd: FIXTURE_PROJECT,
      nodeOptions: [],
    });

    expect(result.exitCode).toBe(0);

    const lines = result.stdout.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(5); // header + separator + 3 angels

    // Header row
    expect(lines[0]).toMatch(/ID\s+TYPE\s+PATH\s+STATUS/);

    // Separator row
    expect(lines[1]).toMatch(/─+\s+─+\s+─+\s+─+/);

    // Data rows — verify each angel appears
    const dataLines = lines.slice(2);
    const rootLine = dataLines.find((l) => l.includes('_root'));
    expect(rootLine).toBeDefined();
    expect(rootLine).toMatch(/root/);
    expect(rootLine).toMatch(/active/);

    const authLine = dataLines.find((l) => l.includes('src-auth'));
    expect(authLine).toBeDefined();
    expect(authLine).toMatch(/folder/);
    expect(authLine).toMatch(/draft/);

    const apiLine = dataLines.find((l) => l.includes('src-api'));
    expect(apiLine).toBeDefined();
    expect(apiLine).toMatch(/folder/);
    // src-api has no angel.md, so status should be '-' (with possible trailing whitespace from padding)
    expect(apiLine).toMatch(/src\/api\s+-\s*$/);
  });

  it('exits with non-zero code and clear error when no config exists', async () => {
    const result = await execaNode(CLI_PATH, ['list'], {
      cwd: '/tmp',
      nodeOptions: [],
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Config file not found/);
    expect(result.stderr).toMatch(/angels init/);
  });
});
