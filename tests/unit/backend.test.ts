import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { ClaudeAdapter } from '../../src/backend/claude.js';
import { CodexAdapter } from '../../src/backend/codex.js';
import { DroidAdapter } from '../../src/backend/droid.js';
import { GenericAdapter } from '../../src/backend/generic.js';
import { pickAdapter } from '../../src/backend/factory.js';
import type { Config } from '../../src/config/schema.js';

const FIXTURES = resolve(import.meta.dirname, '..', 'fixtures');
const ECHO_BACKEND = resolve(FIXTURES, 'echo-backend.sh');
const STDERR_BACKEND = resolve(FIXTURES, 'stderr-backend.sh');

const baseOpts = {
  prompt: 'hello world',
  cwd: FIXTURES,
  timeoutMs: 5000,
};

function makeConfig(angelCmd: string): Config {
  return {
    version: 1,
    backend: {
      angel_cmd: angelCmd,
      angel_timeout_seconds: 600,
    },
    angels: [{ id: '_root', type: 'root', path: '.' }],
    sweep: { autonomy: 'report-only' },
  };
}

// --- ClaudeAdapter ---

describe('ClaudeAdapter', () => {
  it('pipes prompt via stdin and captures stdout', async () => {
    const adapter = new ClaudeAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('passes extra args to the subprocess', async () => {
    // echo-backend.sh ignores args, but we verify args don't break invocation
    const adapter = new ClaudeAdapter(ECHO_BACKEND, ['-p', '--dangerously-skip-permissions']);
    const result = await adapter.invoke({ ...baseOpts, extraArgs: ['--model', 'opus'] });

    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('captures non-zero exit code', async () => {
    const adapter = new ClaudeAdapter(STDERR_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('something went wrong');
  });

  it('extracts session ID from stdout', () => {
    const adapter = new ClaudeAdapter(ECHO_BACKEND, []);

    expect(adapter.extractSessionId('session_id: abc123')).toBe('abc123');
    expect(adapter.extractSessionId('Session-ID: xyz-789')).toBe('xyz-789');
    expect(adapter.extractSessionId('SessionId: sess_001')).toBe('sess_001');
    expect(adapter.extractSessionId('no id here')).toBeNull();
  });

  it('includes sessionId in result when present in stdout', async () => {
    const adapter = new ClaudeAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke({
      ...baseOpts,
      prompt: 'session_id: test-session-42',
    });

    expect(result.sessionId).toBe('test-session-42');
  });

  it('omits sessionId from result when not in stdout', async () => {
    const adapter = new ClaudeAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.sessionId).toBeUndefined();
  });
});

// --- CodexAdapter ---

describe('CodexAdapter', () => {
  it('pipes prompt via stdin and captures stdout', async () => {
    const adapter = new CodexAdapter(ECHO_BACKEND, ['exec']);
    const result = await adapter.invoke(baseOpts);

    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('captures non-zero exit code', async () => {
    const adapter = new CodexAdapter(STDERR_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('something went wrong');
  });

  it('extracts thread ID from stdout', () => {
    const adapter = new CodexAdapter(ECHO_BACKEND, []);

    expect(adapter.extractSessionId('thread_id: thd_abc123')).toBe('thd_abc123');
    expect(adapter.extractSessionId('Thread-ID: xyz')).toBe('xyz');
    expect(adapter.extractSessionId('ThreadId: t001')).toBe('t001');
    expect(adapter.extractSessionId('no thread here')).toBeNull();
  });

  it('includes sessionId in result when thread ID present', async () => {
    const adapter = new CodexAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke({
      ...baseOpts,
      prompt: 'thread_id: thd_42',
    });

    expect(result.sessionId).toBe('thd_42');
  });
});

// --- DroidAdapter ---

describe('DroidAdapter', () => {
  it('pipes prompt via stdin and captures stdout', async () => {
    const adapter = new DroidAdapter(ECHO_BACKEND, ['exec']);
    const result = await adapter.invoke(baseOpts);

    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('captures non-zero exit code', async () => {
    const adapter = new DroidAdapter(STDERR_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('something went wrong');
  });

  it('never returns sessionId', async () => {
    const adapter = new DroidAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke({
      ...baseOpts,
      prompt: 'session_id: abc thread_id: xyz',
    });

    expect(result.sessionId).toBeUndefined();
  });
});

// --- GenericAdapter ---

describe('GenericAdapter', () => {
  it('pipes prompt via stdin and captures stdout', async () => {
    const adapter = new GenericAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('captures non-zero exit code', async () => {
    const adapter = new GenericAdapter(STDERR_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('something went wrong');
  });

  it('never returns sessionId', async () => {
    const adapter = new GenericAdapter(ECHO_BACKEND, []);
    const result = await adapter.invoke({
      ...baseOpts,
      prompt: 'session_id: abc thread_id: xyz',
    });

    expect(result.sessionId).toBeUndefined();
  });

  it('works with extra args', async () => {
    const adapter = new GenericAdapter(ECHO_BACKEND, ['--flag']);
    const result = await adapter.invoke({ ...baseOpts, extraArgs: ['--verbose'] });

    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
  });
});

// --- Factory ---

describe('pickAdapter', () => {
  it('picks ClaudeAdapter for "claude" command', () => {
    const adapter = pickAdapter(makeConfig('claude -p --dangerously-skip-permissions'));
    expect(adapter.name).toBe('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it('picks ClaudeAdapter for full path to claude', () => {
    const adapter = pickAdapter(makeConfig('/usr/local/bin/claude -p'));
    expect(adapter.name).toBe('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it('picks CodexAdapter for "codex" command', () => {
    const adapter = pickAdapter(makeConfig('codex exec'));
    expect(adapter.name).toBe('codex');
    expect(adapter).toBeInstanceOf(CodexAdapter);
  });

  it('picks DroidAdapter for "droid" command', () => {
    const adapter = pickAdapter(makeConfig('droid exec'));
    expect(adapter.name).toBe('droid');
    expect(adapter).toBeInstanceOf(DroidAdapter);
  });

  it('falls back to GenericAdapter for unknown command', () => {
    const adapter = pickAdapter(makeConfig('my-custom-ai --flag'));
    expect(adapter.name).toBe('generic');
    expect(adapter).toBeInstanceOf(GenericAdapter);
  });

  it('falls back to GenericAdapter for full path to unknown command', () => {
    const adapter = pickAdapter(makeConfig('/opt/tools/custom-ai --flag'));
    expect(adapter.name).toBe('generic');
    expect(adapter).toBeInstanceOf(GenericAdapter);
  });

  it('throws on empty angel_cmd', () => {
    expect(() => pickAdapter(makeConfig(''))).toThrow(/empty/i);
  });

  it('preserves args from the command string', () => {
    const adapter = pickAdapter(makeConfig('claude -p --dangerously-skip-permissions --model opus'));
    expect(adapter.name).toBe('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });
});
