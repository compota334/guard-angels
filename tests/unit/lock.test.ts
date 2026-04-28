import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  releaseLock,
  readLock,
  isStale,
  lockFilePath,
} from '../../src/locks/lock.js';
import type { LockInfo } from '../../src/locks/lock.js';

describe('lock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-lock-'));
    // Create the .angels directory structure
    fs.mkdirSync(join(tmpDir, '.angels', '_locks'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('acquires a lock on an unlocked project', () => {
      const lockPath = acquireLock(tmpDir, 60_000);
      expect(fs.existsSync(lockPath)).toBe(true);

      const info = readLock(lockPath);
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(process.pid);
      expect(info!.ttlMs).toBe(60_000);
    });

    it('throws when trying to acquire a lock held by the current process', () => {
      acquireLock(tmpDir, 60_000);

      // Our own PID is alive so the lock is not stale
      expect(() => acquireLock(tmpDir, 60_000)).toThrow(
        /Orchestrator lock is held by PID/,
      );
    });

    it('reclaims a stale lock (TTL expired)', () => {
      // Manually write a lock with an old timestamp
      const lockPath = lockFilePath(tmpDir);
      const staleLock = [
        `pid: ${process.pid}`,
        `started_at: 2020-01-01T00:00:00.000Z`,
        `ttl_ms: 1000`,
      ].join('\n') + '\n';
      fs.writeFileSync(lockPath, staleLock, 'utf-8');

      // Should reclaim since TTL has long expired
      const newLockPath = acquireLock(tmpDir, 60_000);
      expect(fs.existsSync(newLockPath)).toBe(true);

      const info = readLock(newLockPath);
      expect(info!.pid).toBe(process.pid);
      expect(info!.ttlMs).toBe(60_000);
    });

    it('reclaims a stale lock (PID dead)', () => {
      const lockPath = lockFilePath(tmpDir);
      // Use a PID that almost certainly doesn't exist
      const deadPid = 999999;
      const staleLock = [
        `pid: ${deadPid}`,
        `started_at: ${new Date().toISOString()}`,
        `ttl_ms: 999999999`,
      ].join('\n') + '\n';
      fs.writeFileSync(lockPath, staleLock, 'utf-8');

      const newLockPath = acquireLock(tmpDir, 60_000);
      expect(fs.existsSync(newLockPath)).toBe(true);

      const info = readLock(newLockPath);
      expect(info!.pid).toBe(process.pid);
    });

    it('creates the _locks directory if missing', () => {
      // Use a fresh tmpDir without .angels/_locks
      const freshDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-lock-fresh-'));
      try {
        const lockPath = acquireLock(freshDir, 60_000);
        expect(fs.existsSync(lockPath)).toBe(true);
      } finally {
        fs.rmSync(freshDir, { recursive: true, force: true });
      }
    });
  });

  describe('releaseLock', () => {
    it('removes the lock file when owned by the current process', () => {
      acquireLock(tmpDir, 60_000);
      const lockPath = lockFilePath(tmpDir);
      expect(fs.existsSync(lockPath)).toBe(true);

      releaseLock(tmpDir);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('does nothing when no lock exists', () => {
      // Should not throw
      releaseLock(tmpDir);
    });

    it('does not remove a lock owned by another PID', () => {
      const lockPath = lockFilePath(tmpDir);
      const otherPidLock = [
        `pid: 999999`,
        `started_at: ${new Date().toISOString()}`,
        `ttl_ms: 60000`,
      ].join('\n') + '\n';
      fs.writeFileSync(lockPath, otherPidLock, 'utf-8');

      releaseLock(tmpDir);
      // Lock should still exist since it's owned by another PID
      expect(fs.existsSync(lockPath)).toBe(true);
    });
  });

  describe('readLock', () => {
    it('returns null for non-existent lock file', () => {
      const result = readLock('/nonexistent/path/lock');
      expect(result).toBeNull();
    });

    it('returns null for malformed lock file', () => {
      const lockPath = lockFilePath(tmpDir);
      fs.writeFileSync(lockPath, 'garbage content\n', 'utf-8');
      expect(readLock(lockPath)).toBeNull();
    });

    it('parses a valid lock file', () => {
      const lockPath = lockFilePath(tmpDir);
      const content = [
        'pid: 12345',
        'started_at: 2026-04-28T10:00:00.000Z',
        'ttl_ms: 60000',
      ].join('\n') + '\n';
      fs.writeFileSync(lockPath, content, 'utf-8');

      const info = readLock(lockPath);
      expect(info).toEqual({
        pid: 12345,
        startedAt: '2026-04-28T10:00:00.000Z',
        ttlMs: 60000,
      });
    });
  });

  describe('isStale', () => {
    it('returns true when PID is dead', () => {
      const info: LockInfo = {
        pid: 999999,
        startedAt: new Date().toISOString(),
        ttlMs: 999_999_999,
      };
      expect(isStale(info)).toBe(true);
    });

    it('returns true when TTL has elapsed', () => {
      const info: LockInfo = {
        pid: process.pid, // alive
        startedAt: '2020-01-01T00:00:00.000Z', // long ago
        ttlMs: 1000, // 1 second TTL
      };
      expect(isStale(info)).toBe(true);
    });

    it('returns false when PID is alive and TTL has not elapsed', () => {
      const info: LockInfo = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        ttlMs: 999_999_999,
      };
      expect(isStale(info)).toBe(false);
    });

    it('returns true when timestamp is malformed', () => {
      const info: LockInfo = {
        pid: process.pid,
        startedAt: 'not-a-timestamp',
        ttlMs: 999_999_999,
      };
      expect(isStale(info)).toBe(true);
    });
  });
});
