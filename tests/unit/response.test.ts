import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  writeResponse,
  parseResponse,
  parseResponseContent,
  formatResponse,
  type ResponseData,
} from '../../src/protocol/response.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-response-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function baseData(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    from: 'src-auth',
    timestamp: '2026-04-28T14:32:00Z',
    response: 'proceed',
    writeMode: 'proposed',
    concerns: '',
    proposedPlan: 'Add rate limiting middleware.',
    questionsForMain: '',
    proceedIf: '',
    testResults: '',
    driftReport: '',
    cablesSent: [],
    filesChanged: [],
    angelMdUpdated: false,
    ...overrides,
  };
}

/** A minimal valid response JSON document (as an object, stringified by tests). */
function baseJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_version: 1,
    from: 'src-auth',
    timestamp: '2026-04-28T14:32:00Z',
    verdict: 'proceed',
    ...overrides,
  };
}

describe('writeResponse', () => {
  it('creates a .json response file and returns its path', () => {
    const filePath = writeResponse(tmpDir, baseData());

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toMatch(/2026-04-28T1432-\d{4}\.json$/);
    expect(filePath).toContain(join('_responses', 'src-auth'));
  });

  it('creates the angel responses directory if it does not exist', () => {
    const filePath = writeResponse(tmpDir, baseData({ from: 'src-new' }));
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('increments sequence number for same-day responses', () => {
    const path1 = writeResponse(tmpDir, baseData());
    const path2 = writeResponse(tmpDir, baseData({ timestamp: '2026-04-28T15:00:00Z' }));
    const path3 = writeResponse(tmpDir, baseData({ timestamp: '2026-04-28T16:30:00Z' }));

    expect(path1).toMatch(/-0001\.json$/);
    expect(path2).toMatch(/-0002\.json$/);
    expect(path3).toMatch(/-0003\.json$/);
  });

  it('resets sequence number for a different day', () => {
    const path1 = writeResponse(tmpDir, baseData());
    const path2 = writeResponse(tmpDir, baseData({ timestamp: '2026-04-29T10:00:00Z' }));

    expect(path1).toMatch(/2026-04-28T1432-0001\.json$/);
    expect(path2).toMatch(/2026-04-29T1000-0001\.json$/);
  });

  it('serializes the full schema including arrays and flags', () => {
    const filePath = writeResponse(
      tmpDir,
      baseData({
        response: 'done',
        cablesSent: [{ to: 'src-api', type: 'fyi' }],
        filesChanged: ['src/auth/login.ts'],
        angelMdUpdated: true,
      }),
    );

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(parsed.format_version).toBe(1);
    expect(parsed.verdict).toBe('done');
    expect(parsed.cables_sent).toEqual([{ to: 'src-api', type: 'fyi' }]);
    expect(parsed.files_changed).toEqual(['src/auth/login.ts']);
    expect(parsed.angel_md_updated).toBe(true);
  });

  it('throws on invalid ISO timestamp', () => {
    expect(() => writeResponse(tmpDir, baseData({ timestamp: 'not-a-date' }))).toThrow(
      /Invalid ISO timestamp/,
    );
  });

  it('handles sequence gaps', () => {
    const dir = join(tmpDir, '.angels', '_responses', 'src-auth');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, '2026-04-28T1000-0007.json'), '{}');

    const filePath = writeResponse(tmpDir, baseData());
    expect(filePath).toMatch(/-0008\.json$/);
  });

  it('counts legacy .md files toward the sequence', () => {
    const dir = join(tmpDir, '.angels', '_responses', 'src-auth');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, '2026-04-28T1000-0003.md'), 'old');

    const filePath = writeResponse(tmpDir, baseData());
    expect(filePath).toMatch(/-0004\.json$/);
  });
});

describe('parseResponseContent', () => {
  it('parses a proceed response with defaults for omitted fields', () => {
    const data = parseResponseContent(JSON.stringify(baseJson()));

    expect(data.from).toBe('src-auth');
    expect(data.timestamp).toBe('2026-04-28T14:32:00Z');
    expect(data.response).toBe('proceed');
    expect(data.writeMode).toBe('proposed');
    expect(data.concerns).toBe('');
    expect(data.proposedPlan).toBe('');
    expect(data.cablesSent).toEqual([]);
    expect(data.filesChanged).toEqual([]);
    expect(data.angelMdUpdated).toBe(false);
  });

  it('parses a concerns response', () => {
    const data = parseResponseContent(
      JSON.stringify(
        baseJson({
          verdict: 'concerns',
          concerns: 'The endpoint lacks tests.',
          proposed_plan: 'Add tests first, then apply the change.',
          proceed_if: 'Tests are added',
        }),
      ),
    );

    expect(data.response).toBe('concerns');
    expect(data.concerns).toBe('The endpoint lacks tests.');
    expect(data.proposedPlan).toBe('Add tests first, then apply the change.');
    expect(data.proceedIf).toBe('Tests are added');
  });

  it('parses a refuse response', () => {
    const data = parseResponseContent(
      JSON.stringify(
        baseJson({
          verdict: 'refuse',
          concerns: 'This violates INV-002: tokens must never be logged.',
        }),
      ),
    );

    expect(data.response).toBe('refuse');
    expect(data.concerns).toContain('INV-002');
  });

  it('parses a done response with done-only fields', () => {
    const data = parseResponseContent(
      JSON.stringify(
        baseJson({
          verdict: 'done',
          proposed_plan: 'Applied the changes.',
          test_results: '12 passed, 0 failed',
          cables_sent: [
            { to: 'src-api', type: 'fyi' },
            { to: 'src-db', type: 'breaking_change' },
          ],
          files_changed: ['src/auth/login.ts', 'src/auth/rateLimit.ts'],
          angel_md_updated: true,
        }),
      ),
    );

    expect(data.response).toBe('done');
    expect(data.testResults).toBe('12 passed, 0 failed');
    expect(data.cablesSent).toEqual([
      { to: 'src-api', type: 'fyi' },
      { to: 'src-db', type: 'breaking_change' },
    ]);
    expect(data.filesChanged).toEqual(['src/auth/login.ts', 'src/auth/rateLimit.ts']);
    expect(data.angelMdUpdated).toBe(true);
  });

  it('parses a done response with no cables sent', () => {
    const data = parseResponseContent(
      JSON.stringify(baseJson({ verdict: 'done', files_changed: ['a.ts'] })),
    );

    expect(data.cablesSent).toEqual([]);
    expect(data.filesChanged).toEqual(['a.ts']);
  });

  it('parses an error response', () => {
    const data = parseResponseContent(
      JSON.stringify(baseJson({ verdict: 'error', concerns: 'Could not read the folder.' })),
    );

    expect(data.response).toBe('error');
    expect(data.concerns).toBe('Could not read the folder.');
  });

  it('parses write_mode direct', () => {
    const data = parseResponseContent(
      JSON.stringify(baseJson({ verdict: 'done', write_mode: 'direct', angel_md_updated: true })),
    );
    expect(data.writeMode).toBe('direct');
  });

  it('parses write_mode chunk and chunk_final', () => {
    const chunk = parseResponseContent(
      JSON.stringify(baseJson({ verdict: 'done', write_mode: 'chunk' })),
    );
    const chunkFinal = parseResponseContent(
      JSON.stringify(baseJson({ verdict: 'done', write_mode: 'chunk_final' })),
    );
    expect(chunk.writeMode).toBe('chunk');
    expect(chunkFinal.writeMode).toBe('chunk_final');
  });

  it('throws on invalid verdict value', () => {
    expect(() =>
      parseResponseContent(JSON.stringify(baseJson({ verdict: 'approved' }))),
    ).toThrow(/verdict/);
  });

  it('throws on missing from field', () => {
    const json = baseJson();
    delete json.from;
    expect(() => parseResponseContent(JSON.stringify(json))).toThrow(/from/);
  });

  it('throws on missing timestamp field', () => {
    const json = baseJson();
    delete json.timestamp;
    expect(() => parseResponseContent(JSON.stringify(json))).toThrow(/timestamp/);
  });

  it('throws on missing verdict field', () => {
    const json = baseJson();
    delete json.verdict;
    expect(() => parseResponseContent(JSON.stringify(json))).toThrow(/verdict/);
  });

  it('throws on missing format_version', () => {
    const json = baseJson();
    delete json.format_version;
    expect(() => parseResponseContent(JSON.stringify(json))).toThrow(/format_version/);
  });

  it('throws on wrong format_version', () => {
    expect(() =>
      parseResponseContent(JSON.stringify(baseJson({ format_version: 2 }))),
    ).toThrow(/format_version/);
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      parseResponseContent(JSON.stringify(baseJson({ invented_field: 'x' }))),
    ).toThrow(/invented_field|unrecognized/i);
  });

  it('rejects malformed cables_sent entries', () => {
    expect(() =>
      parseResponseContent(
        JSON.stringify(baseJson({ verdict: 'done', cables_sent: [{ to: 'src-api' }] })),
      ),
    ).toThrow(/cables_sent/);
  });

  it('rejects non-string files_changed entries', () => {
    expect(() =>
      parseResponseContent(
        JSON.stringify(baseJson({ verdict: 'done', files_changed: [42] })),
      ),
    ).toThrow(/files_changed/);
  });

  it('rejects done-only fields on proceed response', () => {
    expect(() =>
      parseResponseContent(
        JSON.stringify(baseJson({ verdict: 'proceed', files_changed: ['a.ts'] })),
      ),
    ).toThrow(/files_changed.*done/);
  });

  it('rejects cables_sent on concerns response', () => {
    expect(() =>
      parseResponseContent(
        JSON.stringify(
          baseJson({
            verdict: 'concerns',
            proposed_plan: 'a plan',
            cables_sent: [{ to: 'src-api', type: 'fyi' }],
          }),
        ),
      ),
    ).toThrow(/cables_sent.*done/);
  });

  it('rejects angel_md_updated on refuse response', () => {
    expect(() =>
      parseResponseContent(
        JSON.stringify(baseJson({ verdict: 'refuse', angel_md_updated: true })),
      ),
    ).toThrow(/angel_md_updated.*done/);
  });

  it('rejects done-only fields on error response', () => {
    expect(() =>
      parseResponseContent(
        JSON.stringify(baseJson({ verdict: 'error', files_changed: ['a.ts'] })),
      ),
    ).toThrow(/files_changed.*done/);
  });

  it('throws when verdict is concerns but proposed_plan is empty', () => {
    expect(() =>
      parseResponseContent(JSON.stringify(baseJson({ verdict: 'concerns' }))),
    ).toThrow(/concerns.*proposed_plan/);
  });

  it('throws on invalid JSON with a descriptive message', () => {
    expect(() => parseResponseContent('this is not json')).toThrow(/not valid JSON/);
  });

  it('throws on the old markdown response format', () => {
    const legacy = [
      'FROM: src-auth',
      'TIMESTAMP: 2026-04-28T14:32:00Z',
      'RESPONSE: proceed',
      '',
      'CONCERNS:',
      '',
      'PROPOSED PLAN:',
      'No changes needed.',
    ].join('\n');
    expect(() => parseResponseContent(legacy)).toThrow(/not valid JSON/);
  });

  it('throws on a JSON document that is not an object', () => {
    expect(() => parseResponseContent('["array"]')).toThrow();
    expect(() => parseResponseContent('"string"')).toThrow();
  });

  it('preserves multi-line text fields', () => {
    const data = parseResponseContent(
      JSON.stringify(
        baseJson({ concerns: 'line one\nline two\nline three' }),
      ),
    );
    expect(data.concerns.split('\n')).toHaveLength(3);
  });
});

describe('parseResponse (file-based round trips)', () => {
  function roundTrip(data: ResponseData): ResponseData {
    const filePath = writeResponse(tmpDir, data);
    return parseResponse(filePath);
  }

  it('round-trips a proceed response', () => {
    const data = baseData();
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips a done response with all fields', () => {
    const data = baseData({
      response: 'done',
      proposedPlan: 'Applied.',
      testResults: 'npm test: 12 passed, 0 failed',
      cablesSent: [{ to: 'src-api', type: 'fyi' }],
      filesChanged: ['src/auth/login.ts'],
      angelMdUpdated: true,
    });
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips a concerns response', () => {
    const data = baseData({
      response: 'concerns',
      concerns: 'Risky change.',
      proposedPlan: 'Split into two steps.',
      proceedIf: 'Step one lands first',
    });
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips an error response', () => {
    const data = baseData({ response: 'error', concerns: 'boom', proposedPlan: '' });
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips a refuse response', () => {
    const data = baseData({
      response: 'refuse',
      concerns: 'Violates INV-001.',
      proposedPlan: '',
    });
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips a direct write_mode response', () => {
    const data = baseData({
      response: 'done',
      writeMode: 'direct',
      angelMdUpdated: true,
      proposedPlan: '',
    });
    expect(roundTrip(data)).toEqual(data);
  });

  it('handles _root angel', () => {
    const filePath = writeResponse(tmpDir, baseData({ from: '_root' }));
    expect(filePath).toContain(join('_responses', '_root'));
    expect(parseResponse(filePath).from).toBe('_root');
  });

  it('round-trips a sweep done response with drift report', () => {
    const data = baseData({
      response: 'done',
      driftReport: 'src/auth/session.ts exports changed since last sweep.',
    });
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips a sweep concerns response with drift report', () => {
    const data = baseData({
      response: 'concerns',
      concerns: 'Charter drift.',
      proposedPlan: 'Update the charter section.',
      driftReport: 'Two new files are undocumented.',
    });
    expect(roundTrip(data)).toEqual(data);
  });

  it('round-trips an empty drift report', () => {
    expect(roundTrip(baseData()).driftReport).toBe('');
  });

  it('formatResponse output ends with a newline', () => {
    expect(formatResponse(baseData()).endsWith('\n')).toBe(true);
  });
});
