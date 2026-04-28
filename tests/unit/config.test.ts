import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from '../../src/config/load.js';
import { ConfigSchema } from '../../src/config/schema.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guard-angels-test-'));
}

function writeConfig(dir: string, content: string): void {
  const angelsDir = path.join(dir, '.angels');
  fs.mkdirSync(angelsDir, { recursive: true });
  fs.writeFileSync(path.join(angelsDir, '_config.yml'), content, 'utf-8');
}

const VALID_CONFIG = `
version: 1
backend:
  main_agent_cmd: "claude -p --dangerously-skip-permissions"
  angel_cmd: "claude -p --dangerously-skip-permissions"
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: "."
  - id: src-auth
    type: folder
    path: "src/auth"
sweep:
  autonomy: report-only
`;

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads and validates a correct config file', () => {
    writeConfig(tmpDir, VALID_CONFIG);
    const config = loadConfig(tmpDir);

    expect(config.version).toBe(1);
    expect(config.backend.angel_cmd).toBe('claude -p --dangerously-skip-permissions');
    expect(config.backend.angel_timeout_seconds).toBe(600);
    expect(config.angels).toHaveLength(2);
    expect(config.angels[0]).toEqual({ id: '_root', type: 'root', path: '.' });
    expect(config.angels[1]).toEqual({ id: 'src-auth', type: 'folder', path: 'src/auth' });
    expect(config.sweep.autonomy).toBe('report-only');
  });

  it('loads config without optional main_agent_cmd', () => {
    const config = `
version: 1
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: 300
angels:
  - id: _root
    type: root
    path: "."
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    const result = loadConfig(tmpDir);
    expect(result.backend.main_agent_cmd).toBeUndefined();
    expect(result.backend.angel_cmd).toBe('claude -p');
  });

  it('throws a descriptive error when config file is missing', () => {
    expect(() => loadConfig(tmpDir)).toThrow(/Config file not found/);
    expect(() => loadConfig(tmpDir)).toThrow(/_config\.yml/);
    expect(() => loadConfig(tmpDir)).toThrow(/angels init/);
  });

  it('throws a descriptive error for invalid YAML syntax', () => {
    writeConfig(tmpDir, '{ invalid yaml: [}');
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid YAML/);
  });

  it('throws on missing required field: version', () => {
    const config = `
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: "."
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });

  it('throws on wrong version number', () => {
    const config = `
version: 2
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: "."
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });

  it('throws on missing backend.angel_cmd', () => {
    const config = `
version: 1
backend:
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: "."
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });

  it('throws on invalid angel type', () => {
    const config = `
version: 1
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: invalid_type
    path: "."
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });

  it('throws on empty angels array', () => {
    const config = `
version: 1
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: 600
angels: []
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });

  it('throws on negative timeout', () => {
    const config = `
version: 1
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: -1
angels:
  - id: _root
    type: root
    path: "."
sweep:
  autonomy: report-only
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });

  it('throws on invalid sweep autonomy', () => {
    const config = `
version: 1
backend:
  angel_cmd: "claude -p"
  angel_timeout_seconds: 600
angels:
  - id: _root
    type: root
    path: "."
sweep:
  autonomy: autonomous
`;
    writeConfig(tmpDir, config);
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid config/);
  });
});

describe('ConfigSchema', () => {
  it('rejects non-integer timeout', () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      backend: { angel_cmd: 'cmd', angel_timeout_seconds: 3.5 },
      angels: [{ id: '_root', type: 'root', path: '.' }],
      sweep: { autonomy: 'report-only' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects angel with empty id', () => {
    const result = ConfigSchema.safeParse({
      version: 1,
      backend: { angel_cmd: 'cmd', angel_timeout_seconds: 600 },
      angels: [{ id: '', type: 'root', path: '.' }],
      sweep: { autonomy: 'report-only' },
    });
    expect(result.success).toBe(false);
  });
});
