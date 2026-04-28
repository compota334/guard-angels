import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { createLogStreams, writeLogMeta } from '../../src/logs/log.js';

describe('log', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-log-'));
    // Create the .angels directory structure
    fs.mkdirSync(join(tmpDir, '.angels', '_logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createLogStreams', () => {
    it('creates stdout and stderr log files', () => {
      const streams = createLogStreams(tmpDir, 'src-auth', '2026-04-28T14:32:00Z');

      expect(fs.existsSync(streams.stdoutPath)).toBe(true);
      expect(fs.existsSync(streams.stderrPath)).toBe(true);

      // File names should have sanitized timestamps (colons -> dashes)
      expect(streams.stdoutPath).toContain('2026-04-28T14-32-00Z.stdout');
      expect(streams.stderrPath).toContain('2026-04-28T14-32-00Z.stderr');

      streams.close();
    });

    it('streams data incrementally to log files', () => {
      const streams = createLogStreams(tmpDir, 'src-auth', '2026-04-28T14:32:00Z');

      streams.appendStdout('first line\n');
      streams.appendStdout('second line\n');
      streams.appendStderr('error line\n');

      streams.close();

      const stdout = fs.readFileSync(streams.stdoutPath, 'utf-8');
      expect(stdout).toBe('first line\nsecond line\n');

      const stderr = fs.readFileSync(streams.stderrPath, 'utf-8');
      expect(stderr).toBe('error line\n');
    });

    it('creates the angel-specific log directory if missing', () => {
      // Use a fresh tmpDir without the logs subdirectory
      const logDir = join(tmpDir, '.angels', '_logs', 'test-angel');
      expect(fs.existsSync(logDir)).toBe(false);

      const streams = createLogStreams(tmpDir, 'test-angel', '2026-04-28T10:00:00Z');
      expect(fs.existsSync(logDir)).toBe(true);
      streams.close();
    });

    it('handles rapid successive writes', () => {
      const streams = createLogStreams(tmpDir, 'src-auth', '2026-04-28T14:32:00Z');

      for (let i = 0; i < 100; i++) {
        streams.appendStdout(`line ${i}\n`);
      }

      streams.close();

      const lines = fs.readFileSync(streams.stdoutPath, 'utf-8').split('\n');
      // 100 lines + 1 trailing empty
      expect(lines.length).toBe(101);
      expect(lines[0]).toBe('line 0');
      expect(lines[99]).toBe('line 99');
    });
  });

  describe('writeLogMeta', () => {
    it('writes a .meta.json file with all fields', () => {
      const metaPath = writeLogMeta(tmpDir, 'src-auth', '2026-04-28T14:32:00Z', {
        angelId: 'src-auth',
        phase: 'review',
        briefPath: '/tmp/brief.md',
        responsePath: '/tmp/response.md',
        exitCode: 0,
        sessionId: 'session-123',
        startedAt: '2026-04-28T14:32:00Z',
        finishedAt: '2026-04-28T14:33:00Z',
        timedOut: false,
      });

      expect(metaPath).toContain('2026-04-28T14-32-00Z.meta.json');
      expect(fs.existsSync(metaPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(content.angelId).toBe('src-auth');
      expect(content.phase).toBe('review');
      expect(content.exitCode).toBe(0);
      expect(content.sessionId).toBe('session-123');
      expect(content.timedOut).toBe(false);
    });

    it('writes meta without sessionId when not provided', () => {
      const metaPath = writeLogMeta(tmpDir, 'src-auth', '2026-04-28T14:32:00Z', {
        angelId: 'src-auth',
        phase: 'execute',
        briefPath: '/tmp/brief.md',
        responsePath: '/tmp/response.md',
        exitCode: 1,
        startedAt: '2026-04-28T14:32:00Z',
        finishedAt: '2026-04-28T14:33:00Z',
        timedOut: false,
      });

      const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(content.sessionId).toBeUndefined();
      expect(content.exitCode).toBe(1);
    });

    it('records timeout state in meta', () => {
      const metaPath = writeLogMeta(tmpDir, 'src-auth', '2026-04-28T14:32:00Z', {
        angelId: 'src-auth',
        phase: 'review',
        briefPath: '/tmp/brief.md',
        responsePath: '/tmp/response.md',
        exitCode: 124,
        startedAt: '2026-04-28T14:32:00Z',
        finishedAt: '2026-04-28T14:42:00Z',
        timedOut: true,
      });

      const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(content.timedOut).toBe(true);
      expect(content.exitCode).toBe(124);
    });
  });
});
