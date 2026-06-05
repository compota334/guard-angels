import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeResponse,
  parseResponse,
  parseResponseContent,
  detectWriteMode,
  detectChunkMode,
  parseDirectWriteResponse,
} from '../../src/protocol/response.js';
import type { ResponseData, ParseResult } from '../../src/protocol/response.js';

function makeResponseData(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    from: 'src-auth',
    timestamp: '2026-04-28T14:32:00Z',
    response: 'proceed',
    concerns: '',
    proposedPlan: '1. Update session.ts\n2. Add expiration check',
    questionsForMain: '',
    proceedIf: '',
    testResults: '',
    driftReport: '',
    cablesSent: '',
    filesChanged: '',
    angelMdUpdated: '',
    ...overrides,
  };
}

function makeDoneResponseData(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    from: 'src-auth',
    timestamp: '2026-04-28T14:45:00Z',
    response: 'done',
    concerns: '',
    proposedPlan: '',
    questionsForMain: '',
    proceedIf: '',
    testResults: 'npm test: 12 passed, 0 failed',
    driftReport: '',
    cablesSent: '.angels/_outbox/src-auth/2026-04-28T1445-cable-to-api.md',
    filesChanged: 'src/auth/session.ts, src/auth/middleware.ts',
    angelMdUpdated: 'true',
    ...overrides,
  };
}

describe('writeResponse', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'response-test-'));
    mkdirSync(join(tmpDir, '.angels', '_responses'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a response file and returns its path', () => {
    const data = makeResponseData();
    const filePath = writeResponse(tmpDir, data);

    expect(filePath).toContain('.angels/_responses/src-auth/');
    expect(filePath).toMatch(/2026-04-28T1432-0001\.md$/);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('FROM: src-auth');
    expect(content).toContain('TIMESTAMP: 2026-04-28T14:32:00Z');
    expect(content).toContain('RESPONSE: proceed');
    expect(content).toContain('PROPOSED PLAN:');
    expect(content).toContain('1. Update session.ts');
  });

  it('creates the angel responses directory if it does not exist', () => {
    const data = makeResponseData({ from: 'src-api' });
    const filePath = writeResponse(tmpDir, data);

    expect(filePath).toContain('src-api');
    expect(readFileSync(filePath, 'utf-8')).toContain('FROM: src-api');
  });

  it('increments sequence number for same-day responses', () => {
    const data = makeResponseData();

    const path1 = writeResponse(tmpDir, data);
    expect(path1).toMatch(/-0001\.md$/);

    const path2 = writeResponse(tmpDir, { ...data, timestamp: '2026-04-28T15:00:00Z' });
    expect(path2).toMatch(/-0002\.md$/);

    const path3 = writeResponse(tmpDir, { ...data, timestamp: '2026-04-28T16:30:00Z' });
    expect(path3).toMatch(/-0003\.md$/);
  });

  it('resets sequence number for a different day', () => {
    const data = makeResponseData();

    const path1 = writeResponse(tmpDir, data);
    expect(path1).toMatch(/-0001\.md$/);

    const path2 = writeResponse(tmpDir, {
      ...data,
      timestamp: '2026-04-29T10:00:00Z',
    });
    expect(path2).toMatch(/-0001\.md$/);
  });

  it('includes done-only fields when response is done', () => {
    const data = makeDoneResponseData();
    const filePath = writeResponse(tmpDir, data);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('CABLES SENT: .angels/_outbox/src-auth/2026-04-28T1445-cable-to-api.md');
    expect(content).toContain('FILES CHANGED: src/auth/session.ts, src/auth/middleware.ts');
    expect(content).toContain('ANGEL_MD_UPDATED: true');
  });

  it('omits done-only fields when response is not done', () => {
    const data = makeResponseData({ response: 'proceed' });
    const filePath = writeResponse(tmpDir, data);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('CABLES SENT:');
    expect(content).not.toContain('FILES CHANGED:');
    expect(content).not.toContain('ANGEL_MD_UPDATED:');
  });

  it('throws on invalid ISO timestamp', () => {
    const data = makeResponseData({ timestamp: 'bad-timestamp' });
    expect(() => writeResponse(tmpDir, data)).toThrow('Invalid ISO timestamp');
  });

  it('handles sequence gaps', () => {
    const data = makeResponseData();
    const dir = join(tmpDir, '.angels', '_responses', 'src-auth');
    mkdirSync(dir, { recursive: true });

    // Legacy 3-digit names still parse
    writeFileSync(join(dir, '2026-04-28T1200-001.md'), 'placeholder');
    writeFileSync(join(dir, '2026-04-28T1300-007.md'), 'placeholder');

    const filePath = writeResponse(tmpDir, data);
    expect(filePath).toMatch(/-0008\.md$/);
  });
});

describe('parseResponseContent', () => {
  it('parses a proceed response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '1. Update session.ts',
      '2. Add expiration check',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.from).toBe('src-auth');
    expect(parsed.timestamp).toBe('2026-04-28T14:32:00Z');
    expect(parsed.response).toBe('proceed');
    expect(parsed.concerns).toBe('');
    expect(parsed.proposedPlan).toBe('1. Update session.ts\n2. Add expiration check');
    expect(parsed.questionsForMain).toBe('');
    expect(parsed.proceedIf).toBe('');
    expect(parsed.testResults).toBe('');
    expect(parsed.cablesSent).toBe('');
    expect(parsed.filesChanged).toBe('');
    expect(parsed.angelMdUpdated).toBe('');
  });

  it('parses a concerns response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: concerns',
      '',
      'CONCERNS:',
      '- Session expiration may break active users',
      '- Need to verify token refresh flow',
      '',
      'PROPOSED PLAN:',
      '1. Add TTL to sessions',
      '2. Implement refresh mechanism',
      '',
      'QUESTIONS FOR MAIN:',
      '- What should the default TTL be?',
      '- Should we force-logout or silently refresh?',
      '',
      'PROCEED IF:',
      'Default TTL is specified and refresh behavior is clarified',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('concerns');
    expect(parsed.concerns).toContain('Session expiration may break active users');
    expect(parsed.concerns).toContain('Need to verify token refresh flow');
    expect(parsed.proposedPlan).toContain('Add TTL to sessions');
    expect(parsed.questionsForMain).toContain('What should the default TTL be?');
    expect(parsed.proceedIf).toBe('Default TTL is specified and refresh behavior is clarified');
  });

  it('parses a refuse response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: refuse',
      '',
      'CONCERNS:',
      '- This change violates the security invariant in angel.md',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      'The invariant is updated first with a valid justification',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('refuse');
    expect(parsed.concerns).toContain('security invariant');
    expect(parsed.proceedIf).toContain('invariant is updated first');
  });

  it('parses a done response with done-only fields', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:45:00Z',
      'RESPONSE: done',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      'npm test: 12 passed, 0 failed',
      '',
      'CABLES SENT: .angels/_outbox/src-auth/2026-04-28T1445-cable.md',
      'FILES CHANGED: src/auth/session.ts, src/auth/middleware.ts',
      'ANGEL_MD_UPDATED: true',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('done');
    expect(parsed.testResults).toBe('npm test: 12 passed, 0 failed');
    expect(parsed.cablesSent).toBe('.angels/_outbox/src-auth/2026-04-28T1445-cable.md');
    expect(parsed.filesChanged).toBe('src/auth/session.ts, src/auth/middleware.ts');
    expect(parsed.angelMdUpdated).toBe('true');
  });

  it('parses a done response with no cables sent', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:45:00Z',
      'RESPONSE: done',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'CABLES SENT: none',
      'FILES CHANGED: src/auth/session.ts',
      'ANGEL_MD_UPDATED: false',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('done');
    expect(parsed.cablesSent).toBe('none');
    expect(parsed.filesChanged).toBe('src/auth/session.ts');
    expect(parsed.angelMdUpdated).toBe('false');
  });

  it('parses an error response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: error',
      '',
      'CONCERNS:',
      '- Failed to read the target file: ENOENT',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('error');
    expect(parsed.concerns).toContain('Failed to read the target file');
  });

  it('throws on invalid RESPONSE value', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: approved',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow(
      'Invalid RESPONSE value: "approved". Must be one of: proceed, concerns, refuse, done, error',
    );
  });

  it('throws on missing FROM field', () => {
    const content = [
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow('Missing required field "FROM"');
  });

  it('throws on missing TIMESTAMP field', () => {
    const content = [
      'FROM: src-auth',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow('Missing required field "TIMESTAMP"');
  });

  it('throws on missing RESPONSE field', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow('Missing required field "RESPONSE"');
  });

  it('rejects done-only fields on proceed response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'FILES CHANGED: src/auth/session.ts',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow(
      'Field "FILES CHANGED" is only valid when RESPONSE is "done", but RESPONSE is "proceed"',
    );
  });

  it('rejects CABLES SENT on concerns response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: concerns',
      '',
      'CONCERNS:',
      '- Something',
      '',
      'PROPOSED PLAN:',
      '- Proposed fix here',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'CABLES SENT: some-cable.md',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow(
      'Field "CABLES SENT" is only valid when RESPONSE is "done", but RESPONSE is "concerns"',
    );
  });

  it('rejects ANGEL_MD_UPDATED on refuse response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: refuse',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'ANGEL_MD_UPDATED: true',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow(
      'Field "ANGEL_MD_UPDATED" is only valid when RESPONSE is "done", but RESPONSE is "refuse"',
    );
  });

  it('rejects done-only fields on error response', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: error',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'FILES CHANGED: src/auth/session.ts',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow(
      'Field "FILES CHANGED" is only valid when RESPONSE is "done", but RESPONSE is "error"',
    );
  });

  it('handles trailing whitespace in field values', () => {
    const content = [
      'FROM: src-auth   ',
      'TIMESTAMP: 2026-04-28T14:32:00Z   ',
      'RESPONSE: proceed   ',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.from).toBe('src-auth');
    expect(parsed.timestamp).toBe('2026-04-28T14:32:00Z');
    expect(parsed.response).toBe('proceed');
  });

  it('handles CRLF line endings', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '1. Do the thing',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\r\n');

    const parsed = parseResponseContent(content);
    expect(parsed.from).toBe('src-auth');
    expect(parsed.response).toBe('proceed');
    expect(parsed.proposedPlan).toBe('1. Do the thing');
  });

  it('throws on completely invalid content', () => {
    const content = 'this is not a valid response at all';
    expect(() => parseResponseContent(content)).toThrow('Missing required field');
  });

  it('handles optional TEST_RESULTS section', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '1. Step one',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      'vitest run: 5 passed',
      'npm run build: success',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.testResults).toBe('vitest run: 5 passed\nnpm run build: success');
  });
});

describe('parseResponse (file-based)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'response-parse-'));
    mkdirSync(join(tmpDir, '.angels', '_responses'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips writeResponse -> parseResponse for proceed', () => {
    const original = makeResponseData();
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.from).toBe(original.from);
    expect(parsed.timestamp).toBe(original.timestamp);
    expect(parsed.response).toBe(original.response);
    expect(parsed.proposedPlan).toBe(original.proposedPlan);
    expect(parsed.concerns).toBe('');
    expect(parsed.questionsForMain).toBe('');
    expect(parsed.proceedIf).toBe('');
    expect(parsed.testResults).toBe('');
    expect(parsed.cablesSent).toBe('');
    expect(parsed.filesChanged).toBe('');
    expect(parsed.angelMdUpdated).toBe('');
  });

  it('round-trips writeResponse -> parseResponse for done', () => {
    const original = makeDoneResponseData();
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.from).toBe(original.from);
    expect(parsed.timestamp).toBe(original.timestamp);
    expect(parsed.response).toBe('done');
    expect(parsed.testResults).toBe(original.testResults);
    expect(parsed.cablesSent).toBe(original.cablesSent);
    expect(parsed.filesChanged).toBe(original.filesChanged);
    expect(parsed.angelMdUpdated).toBe(original.angelMdUpdated);
  });

  it('round-trips writeResponse -> parseResponse for concerns', () => {
    const original = makeResponseData({
      response: 'concerns',
      concerns: '- Performance may degrade\n- Missing migration plan',
      proposedPlan: '- Add caching layer\n- Benchmark before and after',
      questionsForMain: '- What is the acceptable latency?',
      proceedIf: 'Latency threshold is defined',
    });
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.response).toBe('concerns');
    expect(parsed.concerns).toBe(original.concerns);
    expect(parsed.proposedPlan).toBe(original.proposedPlan);
    expect(parsed.questionsForMain).toBe(original.questionsForMain);
    expect(parsed.proceedIf).toBe(original.proceedIf);
  });

  it('throws when RESPONSE is concerns but PROPOSED PLAN is empty', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: concerns',
      '',
      'CONCERNS:',
      '- Something looks wrong',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    expect(() => parseResponseContent(content)).toThrow(
      /RESPONSE is "concerns" but PROPOSED PLAN is empty/,
    );
  });

  it('round-trips writeResponse -> parseResponse for error', () => {
    const original = makeResponseData({
      response: 'error',
      concerns: '- Backend process crashed',
    });
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.response).toBe('error');
    expect(parsed.concerns).toBe(original.concerns);
  });

  it('round-trips writeResponse -> parseResponse for refuse', () => {
    const original = makeResponseData({
      response: 'refuse',
      concerns: '- Violates security invariant',
      proceedIf: 'Invariant is updated with justification',
    });
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.response).toBe('refuse');
    expect(parsed.concerns).toBe(original.concerns);
    expect(parsed.proceedIf).toBe(original.proceedIf);
  });

  it('handles _root angel', () => {
    const data = makeResponseData({ from: '_root' });
    const filePath = writeResponse(tmpDir, data);
    const parsed = parseResponse(filePath);
    expect(parsed.from).toBe('_root');
  });

  it('round-trips writeResponse -> parseResponse for sweep done with drift report', () => {
    const original = makeDoneResponseData({
      driftReport: '- Charter section mentions deprecated API endpoint /v1/users\n- Invariant #3 references removed config key',
      angelMdUpdated: 'true',
      filesChanged: '.angels/src/auth/angel.md',
      cablesSent: 'none',
    });
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.response).toBe('done');
    expect(parsed.driftReport).toBe(original.driftReport);
    expect(parsed.angelMdUpdated).toBe('true');
    expect(parsed.filesChanged).toBe('.angels/src/auth/angel.md');
  });

  it('round-trips writeResponse -> parseResponse for sweep concerns with drift report', () => {
    const original = makeResponseData({
      response: 'concerns',
      concerns: '- Detected significant drift in public contract',
      proposedPlan: '- Update angel.md charter and dependencies sections',
      driftReport: '- Function createSession() was removed from session.ts but angel.md still lists it as exported\n- New dependency on src/api not reflected in Dependencies section',
    });
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.response).toBe('concerns');
    expect(parsed.concerns).toBe(original.concerns);
    expect(parsed.proposedPlan).toBe(original.proposedPlan);
    expect(parsed.driftReport).toBe(original.driftReport);
  });

  it('round-trips empty drift report', () => {
    const original = makeResponseData({ driftReport: '' });
    const filePath = writeResponse(tmpDir, original);
    const parsed = parseResponse(filePath);

    expect(parsed.driftReport).toBe('');
  });
});

describe('sweep response parsing', () => {
  it('parses a sweep done response with drift report content', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T16:00:00Z',
      'RESPONSE: done',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'DRIFT REPORT:',
      '- Charter mentions deprecated endpoint /v1/users (removed in commit abc123)',
      '- Invariant #3 references config key that no longer exists',
      '- New export validateToken() not documented in Public contract',
      '',
      'CABLES SENT: none',
      'FILES CHANGED: .angels/src/auth/angel.md',
      'ANGEL_MD_UPDATED: true',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('done');
    expect(parsed.driftReport).toContain('Charter mentions deprecated endpoint');
    expect(parsed.driftReport).toContain('Invariant #3 references config key');
    expect(parsed.driftReport).toContain('New export validateToken()');
    expect(parsed.angelMdUpdated).toBe('true');
    expect(parsed.filesChanged).toBe('.angels/src/auth/angel.md');
  });

  it('parses a sweep concerns response with drift report', () => {
    const content = [
      'FROM: src-api',
      'TIMESTAMP: 2026-04-28T16:05:00Z',
      'RESPONSE: concerns',
      '',
      'CONCERNS:',
      '- Significant drift detected between angel.md and actual folder state',
      '',
      'PROPOSED PLAN:',
      '- Update angel.md charter to reflect routes.ts split and new auth.ts middleware',
      '',
      'QUESTIONS FOR MAIN:',
      '- Should I update angel.md to reflect the current state?',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'DRIFT REPORT:',
      '- routes.ts was split into userRoutes.ts and adminRoutes.ts',
      '- New middleware auth.ts added but not in charter',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('concerns');
    expect(parsed.driftReport).toContain('routes.ts was split');
    expect(parsed.driftReport).toContain('New middleware auth.ts');
    expect(parsed.concerns).toContain('Significant drift detected');
  });

  it('parses a sweep response with empty drift report', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T16:10:00Z',
      'RESPONSE: done',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
      'DRIFT REPORT:',
      '',
      'CABLES SENT: none',
      'FILES CHANGED: none',
      'ANGEL_MD_UPDATED: false',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.response).toBe('done');
    expect(parsed.driftReport).toBe('');
    expect(parsed.angelMdUpdated).toBe('false');
  });

  it('parses a sweep response without drift report section (backward-compatible)', () => {
    const content = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T16:10:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      '',
      'QUESTIONS FOR MAIN:',
      '',
      'PROCEED IF:',
      '',
      'TEST_RESULTS:',
      '',
    ].join('\n');

    const parsed = parseResponseContent(content);
    expect(parsed.driftReport).toBe('');
  });
});

// ─── detectWriteMode ──────────────────────────────────────────────────────────

describe('detectWriteMode', () => {
  it('returns "direct" when WRITE_MODE: DIRECT is present', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: done',
    ].join('\n');

    expect(detectWriteMode(text)).toBe('direct');
  });

  it('returns "proposed" for normal text without WRITE_MODE header', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'PROPOSED PLAN:',
      '1. Do the thing',
    ].join('\n');

    expect(detectWriteMode(text)).toBe('proposed');
  });

  it('returns "direct" when WRITE_MODE: DIRECT and RESPONSE: done are both present', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: done',
    ].join('\n');

    expect(detectWriteMode(text)).toBe('direct');
  });
});

// ─── detectChunkMode ──────────────────────────────────────────────────────────

describe('detectChunkMode', () => {
  it('returns "chunk" when WRITE_MODE: CHUNK is present', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: CHUNK',
      'RESPONSE: proceed',
    ].join('\n');

    expect(detectChunkMode(text)).toBe('chunk');
  });

  it('returns "chunk_final" when WRITE_MODE: CHUNK_FINAL is present', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: CHUNK_FINAL',
      'RESPONSE: done',
    ].join('\n');

    expect(detectChunkMode(text)).toBe('chunk_final');
  });

  it('returns "direct" when WRITE_MODE: DIRECT is present', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: done',
    ].join('\n');

    expect(detectChunkMode(text)).toBe('direct');
  });

  it('returns "proposed" for normal text without any WRITE_MODE header', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'PROPOSED PLAN:',
      '1. Something',
    ].join('\n');

    expect(detectChunkMode(text)).toBe('proposed');
  });
});

// ─── parseDirectWriteResponse ─────────────────────────────────────────────────

describe('parseDirectWriteResponse', () => {
  it('returns status "done" when RESPONSE: done', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: done',
    ].join('\n');

    const result = parseDirectWriteResponse(text);
    expect(result.status).toBe('done');
    expect(result.message).toContain('done');
    expect(result.writeMode).toBe('direct');
    expect(result.directWrite).toBe(true);
  });

  it('returns message containing extra text when RESPONSE: done with a message', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: done',
      '',
      'CONCERNS:',
      'All files updated successfully',
    ].join('\n');

    const result = parseDirectWriteResponse(text);
    expect(result.status).toBe('done');
    expect(result.message).toContain('done');
  });

  it('returns status "error" when RESPONSE: error', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: error',
    ].join('\n');

    const result = parseDirectWriteResponse(text);
    expect(result.status).toBe('error');
    expect(result.message).toContain('error');
  });

  it('returns status "error" with specific error text when RESPONSE: error and PROPOSED PLAN has details', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
      'RESPONSE: error',
      '',
      'PROPOSED PLAN:',
      'Failed to write angel.md: EACCES permission denied',
    ].join('\n');

    const result = parseDirectWriteResponse(text);
    expect(result.status).toBe('error');
    expect(result.message).toContain('error');
    expect(result.body).toContain('Failed to write angel.md');
  });

  it('throws when RESPONSE field is missing', () => {
    const text = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'WRITE_MODE: DIRECT',
    ].join('\n');

    expect(() => parseDirectWriteResponse(text)).toThrow(/missing.*RESPONSE/i);
  });
});
