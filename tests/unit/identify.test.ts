import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identifyCandidates } from '../../src/angels/identify.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'ga-identify-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('identifyCandidates', () => {
  it('selects a folder with at least 3 source files', async () => {
    const dir = join(tmpDir, 'src', 'auth');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'session.ts'), '');
    await writeFile(join(dir, 'middleware.ts'), '');
    await writeFile(join(dir, 'login.ts'), '');
    await writeFile(join(dir, 'signup.ts'), '');
    await writeFile(join(dir, 'logout.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const authCandidate = candidates.find((c) => c.path === 'src/auth');
    expect(authCandidate).toBeDefined();
    expect(authCandidate!.reason).toContain('5 source files');
  });

  it('rejects a folder named "utils" with only 1 file (generic name, too few files)', async () => {
    const dir = join(tmpDir, 'utils');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'helper.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const utilsCandidate = candidates.find((c) => c.path === 'utils');
    expect(utilsCandidate).toBeUndefined();
  });

  it('selects a folder with an index.ts file', async () => {
    const dir = join(tmpDir, 'src', 'components');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const compCandidate = candidates.find((c) => c.path === 'src/components');
    expect(compCandidate).toBeDefined();
    expect(compCandidate!.reason).toContain('index/main file');
  });

  it('selects a folder with a main.py file', async () => {
    const dir = join(tmpDir, 'services');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'main.py'), '');

    const candidates = await identifyCandidates(tmpDir);
    const svcCandidate = candidates.find((c) => c.path === 'services');
    expect(svcCandidate).toBeDefined();
    expect(svcCandidate!.reason).toContain('index/main file');
  });

  it('selects a non-generic folder even with only 1 file', async () => {
    const dir = join(tmpDir, 'payments');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'stripe.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const payCandidate = candidates.find((c) => c.path === 'payments');
    expect(payCandidate).toBeDefined();
    expect(payCandidate!.reason).toContain('non-generic name');
  });

  it('skips node_modules entirely', async () => {
    const nmDir = join(tmpDir, 'node_modules', 'some-pkg');
    await mkdir(nmDir, { recursive: true });
    await writeFile(join(nmDir, 'index.js'), '');
    await writeFile(join(nmDir, 'main.js'), '');
    await writeFile(join(nmDir, 'utils.js'), '');
    await writeFile(join(nmDir, 'lib.js'), '');

    const candidates = await identifyCandidates(tmpDir);
    const nmCandidate = candidates.find((c) => c.path.includes('node_modules'));
    expect(nmCandidate).toBeUndefined();
  });

  it('skips dist directory', async () => {
    const distDir = join(tmpDir, 'dist', 'output');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.js'), '');
    await writeFile(join(distDir, 'a.js'), '');
    await writeFile(join(distDir, 'b.js'), '');
    await writeFile(join(distDir, 'c.js'), '');

    const candidates = await identifyCandidates(tmpDir);
    const distCandidate = candidates.find((c) => c.path.includes('dist'));
    expect(distCandidate).toBeUndefined();
  });

  it('skips .git directory', async () => {
    const gitDir = join(tmpDir, '.git', 'objects');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'pack.js'), '');

    const candidates = await identifyCandidates(tmpDir);
    const gitCandidate = candidates.find((c) => c.path.includes('.git'));
    expect(gitCandidate).toBeUndefined();
  });

  it('skips .angels directory', async () => {
    const angelsDir = join(tmpDir, '.angels', '_root');
    await mkdir(angelsDir, { recursive: true });
    await writeFile(join(angelsDir, 'angel.md'), '');

    const candidates = await identifyCandidates(tmpDir);
    const angelsCandidate = candidates.find((c) =>
      c.path.includes('.angels'),
    );
    expect(angelsCandidate).toBeUndefined();
  });

  it('does not return the project root itself', async () => {
    // Put many source files directly in root
    await writeFile(join(tmpDir, 'a.ts'), '');
    await writeFile(join(tmpDir, 'b.ts'), '');
    await writeFile(join(tmpDir, 'c.ts'), '');
    await writeFile(join(tmpDir, 'd.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const rootCandidate = candidates.find(
      (c) => c.path === '' || c.path === '.',
    );
    expect(rootCandidate).toBeUndefined();
  });

  it('handles nested directories', async () => {
    // Create deep nesting: src/api/v2/handlers with many files
    const deepDir = join(tmpDir, 'src', 'api', 'v2', 'handlers');
    await mkdir(deepDir, { recursive: true });
    await writeFile(join(deepDir, 'get.ts'), '');
    await writeFile(join(deepDir, 'post.ts'), '');
    await writeFile(join(deepDir, 'delete.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const handlersCandidate = candidates.find(
      (c) => c.path === 'src/api/v2/handlers',
    );
    expect(handlersCandidate).toBeDefined();
    expect(handlersCandidate!.reason).toContain('3 source files');
  });

  it('applies custom skipDirs', async () => {
    const customDir = join(tmpDir, 'vendor-custom');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'index.ts'), '');

    const candidates = await identifyCandidates(tmpDir, {
      skipDirs: ['vendor-custom'],
    });
    const customCandidate = candidates.find(
      (c) => c.path === 'vendor-custom',
    );
    expect(customCandidate).toBeUndefined();
  });

  it('ignores non-source files when counting', async () => {
    const dir = join(tmpDir, 'docs');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'README.md'), '');
    await writeFile(join(dir, 'guide.md'), '');
    await writeFile(join(dir, 'notes.txt'), '');
    // Only 1 source file
    await writeFile(join(dir, 'script.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const docsCandidate = candidates.find((c) => c.path === 'docs');
    // "docs" is non-generic, so it should still be selected for that reason
    expect(docsCandidate).toBeDefined();
    expect(docsCandidate!.reason).toContain('non-generic name');
    // But should NOT mention source files >= 3
    expect(docsCandidate!.reason).not.toContain('source files');
  });

  it('combines multiple reasons when applicable', async () => {
    const dir = join(tmpDir, 'authentication');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.ts'), '');
    await writeFile(join(dir, 'session.ts'), '');
    await writeFile(join(dir, 'middleware.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const authCandidate = candidates.find(
      (c) => c.path === 'authentication',
    );
    expect(authCandidate).toBeDefined();
    expect(authCandidate!.reason).toContain('3 source files');
    expect(authCandidate!.reason).toContain('non-generic name');
    expect(authCandidate!.reason).toContain('index/main file');
  });

  it('treats generic names case-insensitively', async () => {
    const dir = join(tmpDir, 'Utils');
    await mkdir(dir, { recursive: true });
    // Only 1 file, generic name → should not be selected
    await writeFile(join(dir, 'helper.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const utilsCandidate = candidates.find((c) => c.path === 'Utils');
    expect(utilsCandidate).toBeUndefined();
  });

  it('selects a generic-named folder if it has enough source files', async () => {
    const dir = join(tmpDir, 'utils');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.ts'), '');
    await writeFile(join(dir, 'b.ts'), '');
    await writeFile(join(dir, 'c.ts'), '');

    const candidates = await identifyCandidates(tmpDir);
    const utilsCandidate = candidates.find((c) => c.path === 'utils');
    expect(utilsCandidate).toBeDefined();
    expect(utilsCandidate!.reason).toContain('3 source files');
  });

  it('returns empty array for empty project', async () => {
    const candidates = await identifyCandidates(tmpDir);
    expect(candidates).toEqual([]);
  });
});
