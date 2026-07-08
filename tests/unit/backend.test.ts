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
const ARG_ECHO_BACKEND = resolve(FIXTURES, 'arg-echo-backend.sh');
const STDERR_BACKEND = resolve(FIXTURES, 'stderr-backend.sh');
const ARG_STDERR_BACKEND = resolve(FIXTURES, 'arg-stderr-backend.sh');

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

const CLAUDE_JSON_BACKEND = resolve(FIXTURES, 'claude-json-backend.sh');

describe('ClaudeAdapter', () => {
  it('appends --output-format json and parses the envelope', async () => {
    const adapter = new ClaudeAdapter(CLAUDE_JSON_BACKEND, ['-p']);
    const result = await adapter.invoke(baseOpts);

    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.argv).toContain('--output-format');
    expect(envelope.argv).toContain('json');
    expect(envelope.argv[envelope.argv.length - 1]).toBe('hello world');

    expect(result.sessionId).toBe('sess-fake-123');
    expect(result.costUsd).toBe(0.42);
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 25,
    });
  });

  it('passes extra args before the prompt', async () => {
    const adapter = new ClaudeAdapter(CLAUDE_JSON_BACKEND, ['-p', '--dangerously-skip-permissions']);
    const result = await adapter.invoke({ ...baseOpts, extraArgs: ['--model', 'opus'] });

    const envelope = JSON.parse(result.stdout);
    expect(envelope.argv).toContain('--model');
    expect(envelope.argv).toContain('opus');
    expect(envelope.argv[envelope.argv.length - 1]).toBe('hello world');
  });

  it('respects an explicit --output-format and skips envelope parsing', async () => {
    const adapter = new ClaudeAdapter(ARG_ECHO_BACKEND, ['--output-format', 'text']);
    const result = await adapter.invoke(baseOpts);

    expect(result.stdout).toBe('hello world');
    expect(result.sessionId).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it('recognizes the --output-format=<value> single-arg form', async () => {
    const adapter = new ClaudeAdapter(ARG_ECHO_BACKEND, ['--output-format=text']);
    const result = await adapter.invoke(baseOpts);

    expect(result.stdout).toBe('hello world');
    expect(result.sessionId).toBeUndefined();
  });

  it('captures non-zero exit code without parsing the envelope', async () => {
    const adapter = new ClaudeAdapter(ARG_STDERR_BACKEND, []);
    const result = await adapter.invoke(baseOpts);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('something went wrong');
  });

  it('omits sessionId when the envelope lacks it', async () => {
    process.env.CLAUDE_FAKE_NO_SESSION = 'true';
    try {
      const adapter = new ClaudeAdapter(CLAUDE_JSON_BACKEND, []);
      const result = await adapter.invoke(baseOpts);
      expect(result.sessionId).toBeUndefined();
      expect(result.usage).toBeDefined();
    } finally {
      delete process.env.CLAUDE_FAKE_NO_SESSION;
    }
  });

  it('throws when exit is 0 but stdout is not the JSON envelope', async () => {
    process.env.CLAUDE_FAKE_BAD_JSON = 'true';
    try {
      const adapter = new ClaudeAdapter(CLAUDE_JSON_BACKEND, []);
      await expect(adapter.invoke(baseOpts)).rejects.toThrow(/JSON envelope/);
    } finally {
      delete process.env.CLAUDE_FAKE_BAD_JSON;
    }
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
