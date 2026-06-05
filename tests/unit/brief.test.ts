import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeBrief, parseBrief, parseBriefContent } from '../../src/protocol/brief.js';
import type { BriefData } from '../../src/protocol/brief.js';

function makeBriefData(overrides: Partial<BriefData> = {}): BriefData {
  return {
    to: 'src-auth',
    from: 'main',
    timestamp: '2026-04-28T14:32:00Z',
    phase: 'review',
    type: 'change_request',
    task: 'Add session expiration logic',
    context: 'User reported that sessions never expire',
    expectedScope: 'src/auth/session.ts, src/auth/middleware.ts',
    priorResponse: 'none',
    ...overrides,
  };
}

describe('writeBrief', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'brief-test-'));
    mkdirSync(join(tmpDir, '.angels', '_briefs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a brief file and returns its path', () => {
    const data = makeBriefData();
    const filePath = writeBrief(tmpDir, data);

    expect(filePath).toContain('.angels/_briefs/src-auth/');
    expect(filePath).toMatch(/2026-04-28T1432-0001\.md$/);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('TO: src-auth');
    expect(content).toContain('FROM: main');
    expect(content).toContain('TIMESTAMP: 2026-04-28T14:32:00Z');
    expect(content).toContain('PHASE: review');
    expect(content).toContain('TYPE: change_request');
    expect(content).toContain('TASK:');
    expect(content).toContain('Add session expiration logic');
    expect(content).toContain('CONTEXT:');
    expect(content).toContain('User reported that sessions never expire');
    expect(content).toContain('EXPECTED SCOPE:');
    expect(content).toContain('src/auth/session.ts, src/auth/middleware.ts');
    expect(content).toContain('PRIOR RESPONSE: none');
  });

  it('creates the angel briefs directory if it does not exist', () => {
    const data = makeBriefData({ to: 'src-api' });
    const filePath = writeBrief(tmpDir, data);

    expect(filePath).toContain('src-api');
    expect(readFileSync(filePath, 'utf-8')).toContain('TO: src-api');
  });

  it('increments sequence number for same-day briefs', () => {
    const data = makeBriefData();

    const path1 = writeBrief(tmpDir, data);
    expect(path1).toMatch(/-0001\.md$/);

    const path2 = writeBrief(tmpDir, { ...data, timestamp: '2026-04-28T15:00:00Z' });
    expect(path2).toMatch(/-0002\.md$/);

    const path3 = writeBrief(tmpDir, { ...data, timestamp: '2026-04-28T16:30:00Z' });
    expect(path3).toMatch(/-0003\.md$/);
  });

  it('resets sequence number for a different day', () => {
    const data = makeBriefData();

    const path1 = writeBrief(tmpDir, data);
    expect(path1).toMatch(/-0001\.md$/);

    const path2 = writeBrief(tmpDir, {
      ...data,
      timestamp: '2026-04-29T10:00:00Z',
    });
    expect(path2).toMatch(/-0001\.md$/);
  });

  it('handles the execute phase', () => {
    const data = makeBriefData({
      phase: 'execute',
      priorResponse: '.angels/_responses/src-auth/2026-04-28T1432-001.md',
    });
    const filePath = writeBrief(tmpDir, data);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('PHASE: execute');
    expect(content).toContain('PRIOR RESPONSE: .angels/_responses/src-auth/2026-04-28T1432-001.md');
  });

  it('handles different TYPE values', () => {
    for (const type of ['change_request', 'consultation', 'sweep'] as const) {
      const data = makeBriefData({ type, to: `angel-${type}` });
      const filePath = writeBrief(tmpDir, data);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain(`TYPE: ${type}`);
    }
  });

  it('throws on invalid ISO timestamp', () => {
    const data = makeBriefData({ timestamp: 'not-a-date' });
    expect(() => writeBrief(tmpDir, data)).toThrow('Invalid ISO timestamp');
  });

  it('handles sequence gaps (non-contiguous)', () => {
    const data = makeBriefData();
    const dir = join(tmpDir, '.angels', '_briefs', 'src-auth');
    mkdirSync(dir, { recursive: true });

    // Manually create files with seq 001 and 005 (legacy 3-digit names still parse)
    writeFileSync(join(dir, '2026-04-28T1200-001.md'), 'placeholder');
    writeFileSync(join(dir, '2026-04-28T1300-005.md'), 'placeholder');

    const filePath = writeBrief(tmpDir, data);
    // Should pick max(5)+1 = 0006
    expect(filePath).toMatch(/-0006\.md$/);
  });

  it('does not overwrite past sequence 999 (4-digit overflow)', () => {
    const data = makeBriefData();
    const dir = join(tmpDir, '.angels', '_briefs', 'src-auth');
    mkdirSync(dir, { recursive: true });

    // A same-day file already at seq 1000. A fixed \d{3} matcher would be
    // blind to it and re-derive 1000, silently overwriting. With \d+ the
    // scanner sees it and advances to 1001.
    writeFileSync(join(dir, '2026-04-28T1200-1000.md'), 'placeholder');

    const filePath = writeBrief(tmpDir, data);
    expect(filePath).toMatch(/-1001\.md$/);
  });
});

describe('parseBrief', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'brief-parse-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips writeBrief -> parseBrief', () => {
    mkdirSync(join(tmpDir, '.angels', '_briefs'), { recursive: true });
    const original = makeBriefData();
    const filePath = writeBrief(tmpDir, original);
    const parsed = parseBrief(filePath);

    expect(parsed.to).toBe(original.to);
    expect(parsed.from).toBe(original.from);
    expect(parsed.timestamp).toBe(original.timestamp);
    expect(parsed.phase).toBe(original.phase);
    expect(parsed.type).toBe(original.type);
    expect(parsed.task).toBe(original.task);
    expect(parsed.context).toBe(original.context);
    expect(parsed.expectedScope).toBe(original.expectedScope);
    expect(parsed.priorResponse).toBe(original.priorResponse);
  });

  it('throws on missing TO field', () => {
    const content = [
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: review',
      'TYPE: change_request',
      '',
      'TASK:',
      'Do something',
      '',
      'PRIOR RESPONSE: none',
    ].join('\n');
    expect(() => parseBriefContent(content)).toThrow('Missing required field "TO"');
  });

  it('throws on missing TASK section', () => {
    const content = [
      'TO: src-auth',
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: review',
      'TYPE: change_request',
      '',
      'PRIOR RESPONSE: none',
    ].join('\n');
    expect(() => parseBriefContent(content)).toThrow('Missing required section: TASK');
  });

  it('throws on invalid PHASE', () => {
    const content = [
      'TO: src-auth',
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: build',
      'TYPE: change_request',
      '',
      'TASK:',
      'Do something',
      '',
      'PRIOR RESPONSE: none',
    ].join('\n');
    expect(() => parseBriefContent(content)).toThrow('Invalid PHASE value: "build"');
  });

  it('throws on invalid TYPE', () => {
    const content = [
      'TO: src-auth',
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: review',
      'TYPE: deploy',
      '',
      'TASK:',
      'Do something',
      '',
      'PRIOR RESPONSE: none',
    ].join('\n');
    expect(() => parseBriefContent(content)).toThrow('Invalid TYPE value: "deploy"');
  });

  it('handles empty CONTEXT and EXPECTED SCOPE', () => {
    const content = [
      'TO: src-auth',
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: review',
      'TYPE: change_request',
      '',
      'TASK:',
      'Do something',
      '',
      'CONTEXT:',
      '',
      'EXPECTED SCOPE:',
      '',
      'PRIOR RESPONSE: none',
    ].join('\n');
    const parsed = parseBriefContent(content);
    expect(parsed.context).toBe('');
    expect(parsed.expectedScope).toBe('');
  });

  it('handles multiline TASK section', () => {
    const content = [
      'TO: src-auth',
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: review',
      'TYPE: change_request',
      '',
      'TASK:',
      'Line one of task.',
      'Line two of task.',
      'Line three of task.',
      '',
      'CONTEXT:',
      'Some context',
      '',
      'EXPECTED SCOPE:',
      'file.ts',
      '',
      'PRIOR RESPONSE: none',
    ].join('\n');
    const parsed = parseBriefContent(content);
    expect(parsed.task).toBe('Line one of task.\nLine two of task.\nLine three of task.');
  });

  it('handles trailing whitespace in field values', () => {
    const content = [
      'TO: src-auth   ',
      'FROM: main   ',
      'TIMESTAMP: 2026-04-28T14:32:00Z   ',
      'PHASE: review   ',
      'TYPE: change_request   ',
      '',
      'TASK:',
      'Do something',
      '',
      'PRIOR RESPONSE: none   ',
    ].join('\n');
    const parsed = parseBriefContent(content);
    expect(parsed.to).toBe('src-auth');
    expect(parsed.from).toBe('main');
    expect(parsed.phase).toBe('review');
    expect(parsed.priorResponse).toBe('none');
  });

  it('handles CRLF line endings', () => {
    const content = [
      'TO: src-auth',
      'FROM: main',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'PHASE: review',
      'TYPE: change_request',
      '',
      'TASK:',
      'Do something',
      '',
      'PRIOR RESPONSE: none',
    ].join('\r\n');
    const parsed = parseBriefContent(content);
    expect(parsed.to).toBe('src-auth');
    expect(parsed.task).toBe('Do something');
  });

  it('throws on malformed brief (completely invalid content)', () => {
    const content = 'this is not a valid brief at all';
    expect(() => parseBriefContent(content)).toThrow('Missing required field');
  });

  it('parses brief with _root angel', () => {
    mkdirSync(join(tmpDir, '.angels', '_briefs'), { recursive: true });
    const data = makeBriefData({ to: '_root' });
    const filePath = writeBrief(tmpDir, data);
    const parsed = parseBrief(filePath);
    expect(parsed.to).toBe('_root');
  });
});
