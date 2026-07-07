import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { writeAngelMd } from '../../src/angels/memory.js';
import {
  runDoctor,
  checkOrphanedAngels,
  checkMissingAngels,
  checkStaleLocks,
  checkStaleDrafts,
  runDoctorChecks,
  archiveOldFiles,
} from '../../src/commands/doctor.js';
import { loadConfig } from '../../src/config/load.js';
import { AngelRegistry } from '../../src/angels/registry.js';

describe('doctor command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-doctor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports zero issues on a clean project', async () => {
    setupCleanProject(tmpDir);

    const config = loadConfig(tmpDir);
    const registry = AngelRegistry.fromConfig(config);
    const report = await runDoctorChecks(tmpDir, config, registry);

    expect(report.orphanedAngels).toHaveLength(0);
    expect(report.missingAngels).toHaveLength(0);
    expect(report.staleLocks).toHaveLength(0);
    expect(report.staleDrafts).toHaveLength(0);
  });

  it('detects orphaned angel (registered but folder missing)', async () => {
    setupProjectWithOrphan(tmpDir);

    const config = loadConfig(tmpDir);
    const orphaned = checkOrphanedAngels(tmpDir, config);

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].id).toBe('api');
    expect(orphaned[0].registeredPath).toBe('api');
  });

  it('detects missing angel (significant folder without angel)', async () => {
    setupProjectWithMissingAngel(tmpDir);

    const config = loadConfig(tmpDir);
    const registry = AngelRegistry.fromConfig(config);
    const missing = await checkMissingAngels(tmpDir, registry);

    expect(missing.length).toBeGreaterThanOrEqual(1);
    const paymentsMissing = missing.find((m) => m.path === 'payments');
    expect(paymentsMissing).toBeDefined();
    expect(paymentsMissing!.reason).toContain('non-generic name');
  });

  it('detects stale lock (PID dead)', () => {
    setupCleanProject(tmpDir);

    // Write a lock file with a dead PID (99999999 is unlikely to be alive)
    const locksPath = join(tmpDir, '.angels', '_locks');
    fs.mkdirSync(locksPath, { recursive: true });
    const lockContent = [
      'pid: 99999999',
      `started_at: ${new Date().toISOString()}`,
      'ttl_ms: 600000',
    ].join('\n') + '\n';
    fs.writeFileSync(join(locksPath, 'orchestrator.lock'), lockContent, 'utf-8');

    const result = checkStaleLocks(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.info.pid).toBe(99999999);
  });

  it('detects stale draft angel.md', () => {
    setupCleanProject(tmpDir);

    // Rewrite auth angel.md as a draft with an old timestamp
    const authAngelMdPath = join(tmpDir, '.angels', 'auth', 'angel.md');
    writeAngelMd(authAngelMdPath, {
      frontmatter: {
        status: 'draft',
        last_updated: '2026-01-01T00:00:00Z',
        last_updated_by: 'main',
      },
      body: '# Angel: auth (folder)\n',
    });

    const config = loadConfig(tmpDir);
    const staleDrafts = checkStaleDrafts(tmpDir, config, 7);

    expect(staleDrafts).toHaveLength(1);
    expect(staleDrafts[0].angelId).toBe('auth');
    expect(staleDrafts[0].daysStale).toBeGreaterThan(7);
  });

  it('does not flag active angel.md as stale draft', () => {
    setupCleanProject(tmpDir);

    const config = loadConfig(tmpDir);
    const staleDrafts = checkStaleDrafts(tmpDir, config, 7);

    expect(staleDrafts).toHaveLength(0);
  });

  it('runDoctor returns exit code 0 on clean project', async () => {
    setupCleanProject(tmpDir);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const exitCode = await runDoctor(tmpDir);
      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes('all checks passed'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it('runDoctor returns exit code 1 when issues found', async () => {
    setupProjectWithOrphan(tmpDir);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const exitCode = await runDoctor(tmpDir);
      expect(exitCode).toBe(1);
      expect(logs.some((l) => l.includes('ORPHANED ANGELS'))).toBe(true);
      expect(logs.some((l) => l.includes('api'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it('checkStaleLocks returns null when no lock file exists', () => {
    setupCleanProject(tmpDir);
    const result = checkStaleLocks(tmpDir);
    expect(result).toBeNull();
  });
});

describe('doctor --archive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-archive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('archives old briefs/responses/logs and preserves relative paths', () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');

    // Create old files in _briefs, _responses, _logs
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000); // 45 days ago

    // Brief file
    const briefDir = join(angelsDir, '_briefs', 'auth');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefFile = join(briefDir, '2026-03-15T1400-001.md');
    fs.writeFileSync(briefFile, 'old brief content', 'utf-8');
    fs.utimesSync(briefFile, oldDate, oldDate);

    // Response file
    const responseDir = join(angelsDir, '_responses', 'auth');
    fs.mkdirSync(responseDir, { recursive: true });
    const responseFile = join(responseDir, '2026-03-15T1400-001.md');
    fs.writeFileSync(responseFile, 'old response content', 'utf-8');
    fs.utimesSync(responseFile, oldDate, oldDate);

    // Log files
    const logDir = join(angelsDir, '_logs', 'auth');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, '2026-03-15T14-00-00.stdout');
    fs.writeFileSync(logFile, 'old log content', 'utf-8');
    fs.utimesSync(logFile, oldDate, oldDate);

    const result = archiveOldFiles(tmpDir, 30);

    // All 3 files should be moved
    expect(result.movedFiles).toHaveLength(3);
    expect(result.thresholdDays).toBe(30);

    // Original files should be gone
    expect(fs.existsSync(briefFile)).toBe(false);
    expect(fs.existsSync(responseFile)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(false);

    // Files should exist in _archive/<YYYY-MM>/ with preserved structure
    const archiveBase = join(angelsDir, '_archive');
    expect(fs.existsSync(archiveBase)).toBe(true);

    // Check that at least one archive YYYY-MM directory was created
    const archiveDirs = fs.readdirSync(archiveBase);
    expect(archiveDirs.length).toBeGreaterThanOrEqual(1);

    // Verify files are accessible at their new locations
    for (const moved of result.movedFiles) {
      expect(fs.existsSync(moved.destPath)).toBe(true);
      const content = fs.readFileSync(moved.destPath, 'utf-8');
      expect(content).toContain('old');
    }
  });

  it('archives old outbox files', () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    const outboxDir = join(angelsDir, '_outbox', 'auth');
    fs.mkdirSync(outboxDir, { recursive: true });
    const outFile = join(outboxDir, '2026-03-15T1400-cable.md');
    fs.writeFileSync(outFile, 'old outbound cable', 'utf-8');
    fs.utimesSync(outFile, oldDate, oldDate);

    const result = archiveOldFiles(tmpDir, 30);

    expect(result.movedFiles).toHaveLength(1);
    expect(fs.existsSync(outFile)).toBe(false);
    expect(result.movedFiles[0].destPath).toContain(join('_archive'));
    expect(result.movedFiles[0].destPath).toContain('_outbox');
  });

  it('archives quarantined inbox cables but never pending inbox messages', () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    // Quarantined malformed cable: should be archived.
    const quarantineDir = join(angelsDir, '_inbox', 'auth', '_quarantine');
    fs.mkdirSync(quarantineDir, { recursive: true });
    const badCable = join(quarantineDir, 'bad-cable.md');
    fs.writeFileSync(badCable, 'malformed', 'utf-8');
    fs.utimesSync(badCable, oldDate, oldDate);

    // Pending inbox message (not quarantined): must be preserved even if old.
    const pending = join(angelsDir, '_inbox', 'auth', 'pending.md');
    fs.writeFileSync(pending, 'pending message', 'utf-8');
    fs.utimesSync(pending, oldDate, oldDate);

    const result = archiveOldFiles(tmpDir, 30);

    expect(result.movedFiles).toHaveLength(1);
    expect(fs.existsSync(badCable)).toBe(false);
    expect(fs.existsSync(pending)).toBe(true);
    expect(result.movedFiles[0].destPath).toContain('_quarantine');
  });

  it('does not archive recent files', () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');

    // Create a recent file in _briefs
    const briefDir = join(angelsDir, '_briefs', '_root');
    fs.mkdirSync(briefDir, { recursive: true });
    const recentBrief = join(briefDir, '2026-04-29T1000-001.md');
    fs.writeFileSync(recentBrief, 'recent brief', 'utf-8');
    // mtime is now (just created) — well within 30 days

    const result = archiveOldFiles(tmpDir, 30);

    expect(result.movedFiles).toHaveLength(0);
    expect(fs.existsSync(recentBrief)).toBe(true);
  });

  it('never archives newspaper, cursors, config, or angel.md', () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');

    // Set old mtimes on protected files
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    const protectedFiles = [
      join(angelsDir, '_newspaper.md'),
      join(angelsDir, '_config.yml'),
      join(angelsDir, '_root', 'angel.md'),
      join(angelsDir, 'auth', 'angel.md'),
    ];

    // Create cursor file
    const cursorDir = join(angelsDir, '_cursors');
    fs.mkdirSync(cursorDir, { recursive: true });
    const cursorFile = join(cursorDir, 'auth');
    fs.writeFileSync(cursorFile, '0', 'utf-8');
    protectedFiles.push(cursorFile);

    for (const f of protectedFiles) {
      if (fs.existsSync(f)) {
        fs.utimesSync(f, oldDate, oldDate);
      }
    }

    const result = archiveOldFiles(tmpDir, 0);

    // None of the protected files should be moved
    expect(result.movedFiles).toHaveLength(0);
    for (const f of protectedFiles) {
      expect(fs.existsSync(f)).toBe(true);
    }
  });

  it('--older-than=0 archives everything older than today', () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');

    // Create a file with yesterday's date
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const briefDir = join(angelsDir, '_briefs', 'auth');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefFile = join(briefDir, 'old.md');
    fs.writeFileSync(briefFile, 'yesterday brief', 'utf-8');
    fs.utimesSync(briefFile, yesterday, yesterday);

    const result = archiveOldFiles(tmpDir, 0);

    // With threshold 0, any file with age > 0ms should be archived
    expect(result.movedFiles).toHaveLength(1);
    expect(fs.existsSync(briefFile)).toBe(false);
  });

  it('runDoctor with --archive prints archive results', async () => {
    setupCleanProject(tmpDir);
    const angelsDir = join(tmpDir, '.angels');

    // Create an old file
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const briefDir = join(angelsDir, '_briefs', '_root');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefFile = join(briefDir, 'old-brief.md');
    fs.writeFileSync(briefFile, 'old content', 'utf-8');
    fs.utimesSync(briefFile, oldDate, oldDate);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const exitCode = await runDoctor(tmpDir, { archive: true, olderThanDays: 30 });
      expect(exitCode).toBe(0); // no doctor issues, just archive
      expect(logs.some((l) => l.includes('Archive: moved 1 file(s)'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});

// --- Helpers ---

function setupCleanProject(projectRoot: string): void {
  // Create source directories — use "auth" directly at root to avoid
  // "src" being flagged as a significant folder by heuristics.
  const authDir = join(projectRoot, 'auth');
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

  // Write _config.yml — only _root and auth
  const config = {
    version: 1,
    backend: {
      angel_cmd: 'echo',
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'auth', type: 'folder', path: 'auth' },
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

  // Create angel.md for _root
  const rootAngelDir = join(angelsDir, '_root');
  fs.mkdirSync(rootAngelDir, { recursive: true });
  writeAngelMd(join(rootAngelDir, 'angel.md'), {
    frontmatter: {
      status: 'active',
      last_updated: new Date().toISOString(),
      last_updated_by: 'main',
    },
    body: '# Angel: . (root)\n\n## Charter\nRoot angel.\n',
  });

  // Create angel.md for auth
  const authAngelDir = join(angelsDir, 'auth');
  fs.mkdirSync(authAngelDir, { recursive: true });
  writeAngelMd(join(authAngelDir, 'angel.md'), {
    frontmatter: {
      status: 'active',
      last_updated: new Date().toISOString(),
      last_updated_by: 'main',
    },
    body: '# Angel: auth (folder)\n\n## Charter\nAuthentication.\n',
  });
}

function setupProjectWithOrphan(projectRoot: string): void {
  setupCleanProject(projectRoot);

  // Register "api" in config but do NOT create the api/ folder
  const angelsDir = join(projectRoot, '.angels');
  const config = {
    version: 1,
    backend: {
      angel_cmd: 'echo',
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'auth', type: 'folder', path: 'auth' },
      { id: 'api', type: 'folder', path: 'api' },
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
}

function setupProjectWithMissingAngel(projectRoot: string): void {
  setupCleanProject(projectRoot);

  // Create a significant folder that is NOT registered as an angel.
  // "payments" is a non-generic name and has >= 3 source files (both required now).
  const paymentsDir = join(projectRoot, 'payments');
  fs.mkdirSync(paymentsDir, { recursive: true });
  fs.writeFileSync(join(paymentsDir, 'index.ts'), 'export {};');
  fs.writeFileSync(join(paymentsDir, 'stripe.ts'), 'export {};');
  fs.writeFileSync(join(paymentsDir, 'paypal.ts'), 'export {};');
}
