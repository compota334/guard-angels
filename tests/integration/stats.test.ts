import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { collectStats, showStats } from '../../src/commands/stats.js';
import { writeLogMeta, type LogMeta } from '../../src/logs/log.js';
import { writeResponse, type ResponseData } from '../../src/protocol/response.js';
import { copyFakeBackend, setupProject } from '../helpers/setup-project.js';

function baseMeta(angelId: string, phase: string, startedAt: string): LogMeta {
  return {
    angelId,
    phase,
    briefPath: `.angels/_briefs/${angelId}/brief.md`,
    responsePath: `.angels/_responses/${angelId}/response.json`,
    exitCode: 0,
    startedAt,
    finishedAt: startedAt,
    timedOut: false,
  };
}

function baseResponse(
  from: string,
  verdict: ResponseData['response'],
  timestamp: string,
  overrides: Partial<ResponseData> = {},
): ResponseData {
  return {
    from,
    timestamp,
    response: verdict,
    writeMode: 'proposed',
    concerns: '',
    proposedPlan: '',
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

function gitInitWithCommit(projectRoot: string, commitDate: string): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: commitDate,
    GIT_COMMITTER_DATE: commitDate,
  };
  execSync('git init -q', { cwd: projectRoot, env });
  execSync('git config user.email test@example.com', { cwd: projectRoot, env });
  execSync('git config user.name Test', { cwd: projectRoot, env });
  execSync('git add .', { cwd: projectRoot, env });
  execSync('git commit -q -m inicial', { cwd: projectRoot, env });
}

describe('collectStats', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-stats-'));
    const fakeBackendPath = copyFakeBackend(tmpDir);
    // Registers _root + src-auth, both active, last_updated 2026-04-28T10:00:00Z
    setupProject(tmpDir, { backendScript: fakeBackendPath });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('aggregates invocations, tokens and cost from live and archived meta files', async () => {
    writeLogMeta(tmpDir, 'src-auth', '2026-06-01T10:00:00Z', {
      ...baseMeta('src-auth', 'REVIEW', '2026-06-01T10:00:00Z'),
      sessionId: 'sess-1',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 300,
      },
      costUsd: 0.05,
    });
    // Pre-0.3 style meta: no usage, no cost
    writeLogMeta(tmpDir, 'src-auth', '2026-06-02T10:00:00Z', {
      ...baseMeta('src-auth', 'EXECUTE', '2026-06-02T10:00:00Z'),
      timedOut: true,
    });
    // Archived meta, as housekeeping would have moved it
    const archivedLogsDir = join(tmpDir, '.angels', '_archive', '2026-05', '_logs', 'src-auth');
    fs.mkdirSync(archivedLogsDir, { recursive: true });
    fs.writeFileSync(
      join(archivedLogsDir, '2026-05-05T10-00-00Z.meta.json'),
      JSON.stringify({
        ...baseMeta('src-auth', 'SWEEP', '2026-05-05T10:00:00Z'),
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        costUsd: 0.01,
      }),
      'utf-8',
    );

    const report = await collectStats(tmpDir);
    const auth = report.angels.find((a) => a.id === 'src-auth')!;

    expect(auth.invocations.total).toBe(3);
    expect(auth.invocations.byPhase).toEqual({ REVIEW: 1, EXECUTE: 1, SWEEP: 1 });
    expect(auth.invocations.timedOut).toBe(1);
    expect(auth.invocations.withUsage).toBe(2);
    expect(auth.tokens).toEqual({
      inputTokens: 110,
      outputTokens: 25,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 300,
    });
    expect(auth.costUsd).toBeCloseTo(0.06, 10);
    expect(report.totals.invocations).toBe(3);
    expect(report.totals.costUsd).toBeCloseTo(0.06, 10);
  });

  it('reports absent usage as null, never as zero', async () => {
    writeLogMeta(tmpDir, 'src-auth', '2026-06-01T10:00:00Z',
      baseMeta('src-auth', 'REVIEW', '2026-06-01T10:00:00Z'));

    const report = await collectStats(tmpDir);
    const auth = report.angels.find((a) => a.id === 'src-auth')!;

    expect(auth.invocations.total).toBe(1);
    expect(auth.invocations.withUsage).toBe(0);
    expect(auth.tokens).toBeNull();
    expect(auth.costUsd).toBeNull();
    expect(report.totals.tokens).toBeNull();
    expect(report.totals.costUsd).toBeNull();
  });

  it('counts verdicts from live and archived responses, and refusals citing invariants', async () => {
    writeResponse(tmpDir, baseResponse('src-auth', 'proceed', '2026-06-01T10:00:00Z'));
    writeResponse(tmpDir, baseResponse('src-auth', 'refuse', '2026-06-02T10:00:00Z', {
      concerns: 'This violates INV-001 and INV-003.',
    }));
    writeResponse(tmpDir, baseResponse('src-auth', 'refuse', '2026-06-03T10:00:00Z', {
      concerns: 'Out of scope for this territory.',
    }));
    writeResponse(tmpDir, baseResponse('src-auth', 'done', '2026-06-04T10:00:00Z', {
      filesChanged: ['src/auth/session.ts'],
    }));
    // Archived response
    const archivedRespDir = join(tmpDir, '.angels', '_archive', '2026-05', '_responses', 'src-auth');
    fs.mkdirSync(archivedRespDir, { recursive: true });
    fs.writeFileSync(
      join(archivedRespDir, '2026-05-05T10-00-00-001.json'),
      JSON.stringify({
        format_version: 1,
        from: 'src-auth',
        timestamp: '2026-05-05T10:00:00Z',
        verdict: 'concerns',
        proposed_plan: 'Split the change in two.',
      }),
      'utf-8',
    );

    const report = await collectStats(tmpDir);
    const auth = report.angels.find((a) => a.id === 'src-auth')!;

    expect(auth.responsesParsed).toBe(5);
    expect(auth.verdicts).toEqual({ proceed: 1, concerns: 1, refuse: 2, done: 1, error: 0 });
    expect(auth.refusalsCitingInvariants).toBe(1);
    expect(report.totals.verdicts.refuse).toBe(2);
    expect(report.totals.refusalsCitingInvariants).toBe(1);
  });

  it('skips malformed meta and response files with a warning instead of failing', async () => {
    const logsDir = join(tmpDir, '.angels', '_logs', 'src-auth');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(join(logsDir, 'broken.meta.json'), 'not json', 'utf-8');
    const respDir = join(tmpDir, '.angels', '_responses', '_root');
    fs.mkdirSync(respDir, { recursive: true });
    fs.writeFileSync(join(respDir, '2026-06-01T10-00-00-001.json'), '{"garbage": true}', 'utf-8');

    const report = await collectStats(tmpDir);

    expect(report.totals.invocations).toBe(0);
    expect(report.totals.verdicts).toEqual({ proceed: 0, concerns: 0, refuse: 0, done: 0, error: 0 });
    expect(report.warnings.some((w) => w.includes('broken.meta.json'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('2026-06-01T10-00-00-001.json'))).toBe(true);
  });

  it('filters invocations and responses by --since', async () => {
    writeLogMeta(tmpDir, 'src-auth', '2026-06-01T10:00:00Z',
      baseMeta('src-auth', 'REVIEW', '2026-06-01T10:00:00Z'));
    writeLogMeta(tmpDir, 'src-auth', '2026-07-01T10:00:00Z',
      baseMeta('src-auth', 'REVIEW', '2026-07-01T10:00:00Z'));
    writeResponse(tmpDir, baseResponse('src-auth', 'proceed', '2026-06-01T10:00:00Z'));
    writeResponse(tmpDir, baseResponse('src-auth', 'proceed', '2026-07-01T10:00:00Z'));

    const report = await collectStats(tmpDir, { since: '2026-06-15T00:00:00Z' });
    const auth = report.angels.find((a) => a.id === 'src-auth')!;

    expect(report.since).toBe('2026-06-15T00:00:00Z');
    expect(auth.invocations.total).toBe(1);
    expect(auth.responsesParsed).toBe(1);
  });

  it('throws on an invalid --since value', async () => {
    await expect(collectStats(tmpDir, { since: 'yesterday' })).rejects.toThrow(/Invalid --since/);
  });

  it('computes staleness from angel.md last_updated vs the territory last commit', async () => {
    // setupProject writes last_updated 2026-04-28T10:00:00Z; commit 12 days later
    gitInitWithCommit(tmpDir, '2026-05-10T10:00:00Z');

    const report = await collectStats(tmpDir);
    const auth = report.angels.find((a) => a.id === 'src-auth')!;
    const root = report.angels.find((a) => a.id === '_root')!;

    expect(auth.memory.lastCurated).toBe('2026-04-28T10:00:00Z');
    expect(auth.memory.territoryLastCommit).not.toBeNull();
    expect(auth.memory.staleDays).toBe(12);
    expect(root.memory.staleDays).toBe(12);
    expect(report.warnings).toEqual([]);
  });

  it('reports staleness zero when the memory is newer than the territory', async () => {
    gitInitWithCommit(tmpDir, '2026-04-01T10:00:00Z');

    const report = await collectStats(tmpDir);
    const auth = report.angels.find((a) => a.id === 'src-auth')!;

    expect(auth.memory.staleDays).toBe(0);
  });

  it('announces when git history is unavailable and leaves staleness null', async () => {
    // No git init: git log walks up from the temp dir and finds no repository
    const report = await collectStats(tmpDir);
    const auth = report.angels.find((a) => a.id === 'src-auth')!;

    expect(auth.memory.lastCurated).toBe('2026-04-28T10:00:00Z');
    expect(auth.memory.territoryLastCommit).toBeNull();
    expect(auth.memory.staleDays).toBeNull();
    expect(report.warnings.some((w) => w.includes('Staleness not computed'))).toBe(true);
  });
});

describe('showStats', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-stats-'));
    const fakeBackendPath = copyFakeBackend(tmpDir);
    setupProject(tmpDir, { backendScript: fakeBackendPath });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('prints activity and freshness tables with a TOTAL row', async () => {
    writeLogMeta(tmpDir, 'src-auth', '2026-06-01T10:00:00Z', {
      ...baseMeta('src-auth', 'REVIEW', '2026-06-01T10:00:00Z'),
      usage: {
        inputTokens: 1000,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 2000,
      },
      costUsd: 0.1234,
    });
    writeResponse(tmpDir, baseResponse('src-auth', 'proceed', '2026-06-01T10:00:00Z'));

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });

    await showStats(tmpDir, {});
    const output = lines.join('\n');

    expect(output).toMatch(/ANGEL\s+INVOC\s+PROCEED/);
    expect(output).toContain('TOTAL');
    expect(output).toContain('$0.1234');
    expect(output).toContain('1,000');
    expect(output).toMatch(/LAST CURATED\s+TERRITORY COMMIT\s+STALE/);
    // _root has no invocations: usage absence surfaces as "-", not 0 tokens
    const rootLine = lines.find((l) => l.startsWith('_root'))!;
    expect(rootLine).toContain('-');
  });

  it('prints the full report as JSON with --json', async () => {
    writeResponse(tmpDir, baseResponse('src-auth', 'proceed', '2026-06-01T10:00:00Z'));

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });

    await showStats(tmpDir, { json: true });

    const parsed = JSON.parse(lines.join('\n')) as {
      angels: { id: string; verdicts: { proceed: number } }[];
      totals: { verdicts: { proceed: number } };
    };
    expect(parsed.totals.verdicts.proceed).toBe(1);
    expect(parsed.angels.find((a) => a.id === 'src-auth')!.verdicts.proceed).toBe(1);
  });
});
