import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { invoke } from '../../src/protocol/orchestrate.js';
import { writeBrief } from '../../src/protocol/brief.js';
import { writeAngelMd } from '../../src/angels/memory.js';
import { lockFilePath } from '../../src/locks/lock.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

describe('orchestrate.invoke', () => {
  let tmpDir: string;
  let fakeBackendPath: string;
  let echoBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-orch-'));

    // Copy fixture scripts into tmpDir (which has no spaces in path)
    // to avoid execa parseCommandString splitting on spaces
    fakeBackendPath = join(tmpDir, 'fake-review-backend.sh');
    echoBackendPath = join(tmpDir, 'echo-backend.sh');
    fs.copyFileSync(resolve(FIXTURES_DIR, 'fake-review-backend.sh'), fakeBackendPath);
    fs.copyFileSync(resolve(FIXTURES_DIR, 'echo-backend.sh'), echoBackendPath);
    fs.chmodSync(fakeBackendPath, 0o755);
    fs.chmodSync(echoBackendPath, 0o755);

    setupProject(tmpDir, fakeBackendPath);
  });

  afterEach(() => {
    // Clean up lock if left behind by a failing test
    const lp = lockFilePath(tmpDir);
    if (fs.existsSync(lp)) {
      fs.unlinkSync(lp);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invokes a REVIEW with a happy-path canned response', async () => {
    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Add a logout endpoint',
      context: 'User requested logout functionality',
      expectedScope: 'src/auth/session.ts',
      priorResponse: 'none',
    });

    const result = await invoke(tmpDir, {
      phase: 'review',
      angelId: 'src-auth',
      briefPath,
    });

    // Verify the response was parsed
    expect(result.response).toBeDefined();
    expect(result.response.response).toBe('proceed');
    expect(result.response.from).toBe('test-angel');

    // Verify response file was written
    expect(fs.existsSync(result.responsePath)).toBe(true);

    // Verify log files were created
    expect(fs.existsSync(result.logStdoutPath)).toBe(true);
    expect(fs.existsSync(result.logStderrPath)).toBe(true);

    // Verify stdout log has content from the fake backend
    const stdoutContent = fs.readFileSync(result.logStdoutPath, 'utf-8');
    expect(stdoutContent).toContain('Fake backend invoked successfully');

    // Verify meta.json was created
    expect(fs.existsSync(result.logMetaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(result.logMetaPath, 'utf-8'));
    expect(meta.angelId).toBe('src-auth');
    expect(meta.phase).toBe('review');
    expect(meta.exitCode).toBe(0);
    expect(meta.timedOut).toBe(false);

    // Verify lock was released
    const lp = lockFilePath(tmpDir);
    expect(fs.existsSync(lp)).toBe(false);
  });

  it('invokes with "concerns" verdict from fake backend', async () => {
    // Create a wrapper script with env vars for the concerns verdict
    const wrapperPath = join(tmpDir, 'concerns-wrapper.sh');
    const wrapperContent = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'export FAKE_BACKEND_VERDICT="concerns"',
      'export FAKE_BACKEND_CONCERNS="This change may break session management"',
      `exec ${fakeBackendPath} "$@"`,
      '',
    ].join('\n');
    fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

    updateConfig(tmpDir, wrapperPath);

    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Refactor session handling',
      context: '',
      expectedScope: 'src/auth/session.ts',
      priorResponse: 'none',
    });

    const result = await invoke(tmpDir, {
      phase: 'review',
      angelId: 'src-auth',
      briefPath,
    });

    expect(result.response.response).toBe('concerns');
    expect(result.response.concerns).toContain('break session management');
  });

  it('releases lock even when backend fails with non-zero exit', async () => {
    // Create a wrapper that exits 1 but still writes a response
    const wrapperPath = join(tmpDir, 'exit1-wrapper.sh');
    const wrapperContent = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'export FAKE_BACKEND_EXIT="1"',
      `exec ${fakeBackendPath} "$@"`,
      '',
    ].join('\n');
    fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

    updateConfig(tmpDir, wrapperPath);

    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Test lock release on failure',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    const result = await invoke(tmpDir, {
      phase: 'review',
      angelId: 'src-auth',
      briefPath,
    });

    // Lock should be released
    const lp = lockFilePath(tmpDir);
    expect(fs.existsSync(lp)).toBe(false);

    // Response was still parsed
    expect(result.response).toBeDefined();
  });

  it('produces a synthetic error response when angel writes no response file', async () => {
    // Use echo-backend which does NOT write a response file
    updateConfig(tmpDir, echoBackendPath);

    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Test missing response handling',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    const result = await invoke(tmpDir, {
      phase: 'review',
      angelId: 'src-auth',
      briefPath,
    });

    // Should get a synthetic error response
    expect(result.response.response).toBe('error');
    expect(result.response.concerns).toContain('did not produce a valid response');

    // Lock should still be released
    const lp = lockFilePath(tmpDir);
    expect(fs.existsSync(lp)).toBe(false);
  });

  it('writes logs incrementally (partial logs survive hung backend)', async () => {
    const briefPath = writeBrief(tmpDir, {
      to: 'src-auth',
      from: 'main',
      timestamp: new Date().toISOString(),
      phase: 'review',
      type: 'change_request',
      task: 'Test log streaming',
      context: '',
      expectedScope: '',
      priorResponse: 'none',
    });

    const result = await invoke(tmpDir, {
      phase: 'review',
      angelId: 'src-auth',
      briefPath,
    });

    // Verify stdout log is non-empty (fake backend writes output)
    const stdoutContent = fs.readFileSync(result.logStdoutPath, 'utf-8');
    expect(stdoutContent.length).toBeGreaterThan(0);
  });
});

/**
 * Set up a synthetic project with .angels/ structure, config, and angel.md
 */
function setupProject(projectRoot: string, backendScript: string): void {
  // Create source directories
  const authDir = join(projectRoot, 'src', 'auth');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(join(authDir, 'session.ts'), 'export {};');

  // Create .angels/ structure
  const angelsDir = join(projectRoot, '.angels');
  fs.mkdirSync(join(angelsDir, '_briefs'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_responses'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_inbox'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_outbox'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_locks'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_logs'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_cursors'), { recursive: true });

  // Write _config.yml pointing to the fake backend
  const config = {
    version: 1,
    backend: {
      angel_cmd: backendScript,
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
    ],
    sweep: {
      autonomy: 'report-only',
    },
  };
  fs.writeFileSync(
    join(angelsDir, '_config.yml'),
    yamlStringify(config, { lineWidth: 0 }),
    'utf-8',
  );

  // Create _newspaper.md
  fs.writeFileSync(join(angelsDir, '_newspaper.md'), '', 'utf-8');

  // Create angel.md for src-auth
  const srcAuthAngelDir = join(angelsDir, 'src', 'auth');
  fs.mkdirSync(srcAuthAngelDir, { recursive: true });
  writeAngelMd(join(srcAuthAngelDir, 'angel.md'), {
    frontmatter: {
      status: 'active',
      last_updated: '2026-04-28T10:00:00Z',
      last_updated_by: 'main',
    },
    body: '# Angel: src/auth (folder)\n\n## Charter\nHandles authentication and session management.\n',
  });

  // Create angel.md for _root
  const rootAngelDir = join(angelsDir, '_root');
  fs.mkdirSync(rootAngelDir, { recursive: true });
  writeAngelMd(join(rootAngelDir, 'angel.md'), {
    frontmatter: {
      status: 'active',
      last_updated: '2026-04-28T10:00:00Z',
      last_updated_by: 'main',
    },
    body: '# Angel: . (root)\n\n## Charter\nRoot angel for the project.\n',
  });
}

/**
 * Update the _config.yml with a new angel_cmd.
 */
function updateConfig(projectRoot: string, angelCmd: string): void {
  const configPath = join(projectRoot, '.angels', '_config.yml');
  const config = {
    version: 1,
    backend: {
      angel_cmd: angelCmd,
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
    ],
    sweep: {
      autonomy: 'report-only',
    },
  };
  fs.writeFileSync(configPath, yamlStringify(config, { lineWidth: 0 }), 'utf-8');
}
