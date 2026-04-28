import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectExistingMemory } from '../../src/angels/ingest.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'ga-ingest-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('detectExistingMemory', () => {
  it('detects AGENTS.md in a folder', async () => {
    const folder = join(tmpDir, 'src', 'auth');
    await mkdir(folder, { recursive: true });
    const content = '# Auth module\nHandles authentication and session management.';
    await writeFile(join(folder, 'AGENTS.md'), content);

    const result = await detectExistingMemory(folder, tmpDir);
    expect(result.source).toBe('AGENTS.md');
    expect(result.content).toBe(content);
  });

  it('detects CLAUDE.md in a non-root folder', async () => {
    const folder = join(tmpDir, 'src', 'api');
    await mkdir(folder, { recursive: true });
    const content = '# API module\nRoutes and controllers.';
    await writeFile(join(folder, 'CLAUDE.md'), content);

    const result = await detectExistingMemory(folder, tmpDir);
    expect(result.source).toBe('CLAUDE.md');
    expect(result.content).toBe(content);
  });

  it('prefers AGENTS.md over CLAUDE.md when both exist', async () => {
    const folder = join(tmpDir, 'src', 'shared');
    await mkdir(folder, { recursive: true });
    const agentsContent = '# From AGENTS.md';
    const claudeContent = '# From CLAUDE.md';
    await writeFile(join(folder, 'AGENTS.md'), agentsContent);
    await writeFile(join(folder, 'CLAUDE.md'), claudeContent);

    const result = await detectExistingMemory(folder, tmpDir);
    expect(result.source).toBe('AGENTS.md');
    expect(result.content).toBe(agentsContent);
  });

  it('ignores CLAUDE.md at the project root', async () => {
    // Project root CLAUDE.md is the user's main-agent instructions
    const claudeContent = '# Main agent instructions\nDo not use as angel memory.';
    await writeFile(join(tmpDir, 'CLAUDE.md'), claudeContent);

    const result = await detectExistingMemory(tmpDir, tmpDir);
    expect(result.source).toBeNull();
    expect(result.content).toBeNull();
  });

  it('detects AGENTS.md even at project root', async () => {
    // AGENTS.md is always valid, even at root
    const content = '# Root agents notes';
    await writeFile(join(tmpDir, 'AGENTS.md'), content);

    const result = await detectExistingMemory(tmpDir, tmpDir);
    expect(result.source).toBe('AGENTS.md');
    expect(result.content).toBe(content);
  });

  it('returns null source and content when no memory files exist', async () => {
    const folder = join(tmpDir, 'src', 'empty');
    await mkdir(folder, { recursive: true });

    const result = await detectExistingMemory(folder, tmpDir);
    expect(result.source).toBeNull();
    expect(result.content).toBeNull();
  });

  it('handles a folder with only regular source files', async () => {
    const folder = join(tmpDir, 'src', 'utils');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'helpers.ts'), 'export function foo() {}');
    await writeFile(join(folder, 'constants.ts'), 'export const X = 1;');

    const result = await detectExistingMemory(folder, tmpDir);
    expect(result.source).toBeNull();
    expect(result.content).toBeNull();
  });

  it('reads full content including multi-line files', async () => {
    const folder = join(tmpDir, 'src', 'database');
    await mkdir(folder, { recursive: true });
    const content = [
      '# Database Module',
      '',
      '## Patterns',
      '- Use connection pooling',
      '- All queries are parameterized',
      '',
      '## Cross-file invariants',
      '- schema.ts defines all tables',
      '- migrations/ must stay in sync with schema.ts',
    ].join('\n');
    await writeFile(join(folder, 'AGENTS.md'), content);

    const result = await detectExistingMemory(folder, tmpDir);
    expect(result.source).toBe('AGENTS.md');
    expect(result.content).toBe(content);
  });
});
