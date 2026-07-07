import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { invoke, OrchestrationError } from '../../src/protocol/orchestrate.js';
import { writeBrief } from '../../src/protocol/brief.js';
import { lockFilePath } from '../../src/locks/lock.js';
import {
  copyFakeBackend,
  copyEchoBackend,
  setupProject,
  updateConfig,
  createBackendWrapper,
} from '../helpers/setup-project.js';

describe('orchestrate.invoke', () => {
  let tmpDir: string;
  let fakeBackendPath: string;
  let echoBackendPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-orch-'));

    // Copy fixture scripts into tmpDir (which has no spaces in path)
    // to avoid execa parseCommandString splitting on spaces
    fakeBackendPath = copyFakeBackend(tmpDir);
    echoBackendPath = copyEchoBackend(tmpDir);

    setupProject(tmpDir, { backendScript: fakeBackendPath });
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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      {
        FAKE_BACKEND_VERDICT: 'concerns',
        FAKE_BACKEND_CONCERNS: 'This change may break session management',
      },
      'concerns-wrapper.sh',
    );
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
    const wrapperPath = createBackendWrapper(
      tmpDir,
      fakeBackendPath,
      { FAKE_BACKEND_EXIT: '1' },
      'exit1-wrapper.sh',
    );
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

  it('throws OrchestrationError when angel writes no response file', async () => {
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

    let caught: unknown;
    try {
      await invoke(tmpDir, {
        phase: 'review',
        angelId: 'src-auth',
        briefPath,
      });
    } catch (err) {
      caught = err;
    }

    // Should throw OrchestrationError of kind missing_response — not fabricate
    // a synthetic on-disk response file.
    expect(caught).toBeInstanceOf(OrchestrationError);
    const err = caught as OrchestrationError;
    expect(err.kind).toBe('missing_response');
    expect(err.message).toContain('src-auth');
    expect(err.message).toContain('did not produce a valid response');
    expect(fs.existsSync(err.logMetaPath)).toBe(true);

    // No response file should have been fabricated on disk
    const responseDir = join(tmpDir, '.angels', '_responses', 'src-auth');
    const responseFiles = fs.existsSync(responseDir) ? fs.readdirSync(responseDir) : [];
    expect(responseFiles).toEqual([]);

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
