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
} from '../../src/commands/doctor.js';
import { loadConfig } from '../../src/config/load.js';
import { AngelRegistry } from '../../src/angels/registry.js';

describe('doctor command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-doctor-'));
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
  // "payments" is a non-generic name → flagged by heuristic.
  const paymentsDir = join(projectRoot, 'payments');
  fs.mkdirSync(paymentsDir, { recursive: true });
  // Add an index file to make it significant by heuristics
  fs.writeFileSync(join(paymentsDir, 'index.ts'), 'export {};');
}
