import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { listAngels } from '../../src/commands/list.js';
import { createAngel } from '../../src/commands/create.js';
import { sendCable } from '../../src/commands/cable.js';
import { showInbox } from '../../src/commands/inbox.js';
import { showNewspaper } from '../../src/commands/newspaper.js';
import { executeAngel } from '../../src/commands/execute.js';
import { writeAngelMd } from '../../src/angels/memory.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angels-errs-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Create a minimal initialized project.
 */
function setupProject(dir: string): void {
  const angelsDir = join(dir, '.angels');
  for (const sub of ['_briefs', '_responses', '_inbox', '_outbox', '_locks', '_logs', '_cursors']) {
    fs.mkdirSync(join(angelsDir, sub), { recursive: true });
  }

  const config = {
    version: 1,
    backend: {
      angel_cmd: 'echo noop',
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
    ],
    sweep: { autonomy: 'report-only' },
  };
  fs.writeFileSync(join(angelsDir, '_config.yml'), yamlStringify(config, { lineWidth: 0 }), 'utf-8');
  fs.writeFileSync(join(angelsDir, '_newspaper.md'), '', 'utf-8');

  // Create angel.md files
  fs.mkdirSync(join(angelsDir, '_root'), { recursive: true });
  writeAngelMd(join(angelsDir, '_root', 'angel.md'), {
    frontmatter: { status: 'active', last_updated: '2026-04-28T10:00:00Z', last_updated_by: 'main' },
    body: '# Root angel\n',
  });

  // Create source directories
  fs.mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(join(dir, 'src', 'auth', 'session.ts'), 'export {};');
}

describe('error messages include relevant context', () => {
  describe('commands on uninitialized project', () => {
    it('list names the missing config file path', () => {
      expect(() => listAngels(tmpDir)).toThrow(/_config\.yml/);
      expect(() => listAngels(tmpDir)).toThrow(/angels init/);
    });

    it('create names the missing config file path', async () => {
      await expect(createAngel(tmpDir, 'src/foo')).rejects.toThrow(/_config\.yml/);
      await expect(createAngel(tmpDir, 'src/foo')).rejects.toThrow(/angels init/);
    });

    it('inbox names the missing config file path', () => {
      expect(() => showInbox(tmpDir, 'src-auth')).toThrow(/_config\.yml/);
    });

    it('newspaper names the missing config file path', () => {
      expect(() => showNewspaper(tmpDir)).toThrow(/_config\.yml/);
    });
  });

  describe('unknown angel ID', () => {
    beforeEach(() => setupProject(tmpDir));

    it('brief/execute/inbox list registered angels when ID not found', () => {
      expect(() => showInbox(tmpDir, 'nonexistent')).toThrow(/nonexistent/);
      expect(() => showInbox(tmpDir, 'nonexistent')).toThrow(/Registered angels/);
      expect(() => showInbox(tmpDir, 'nonexistent')).toThrow(/_root/);
    });

    it('cable with unknown recipient lists registered angels', () => {
      expect(() => sendCable(tmpDir, 'no-such-angel', 'fyi', 'test')).toThrow(/no-such-angel/);
      expect(() => sendCable(tmpDir, 'no-such-angel', 'fyi', 'test')).toThrow(/Registered angels/);
    });
  });

  describe('cable validation errors', () => {
    beforeEach(() => setupProject(tmpDir));

    it('invalid cable type lists valid types', () => {
      expect(() => sendCable(tmpDir, 'src-auth', 'invalid_type', 'test')).toThrow(/invalid_type/);
      expect(() => sendCable(tmpDir, 'src-auth', 'invalid_type', 'test')).toThrow(/breaking_change/);
    });

    it('invalid urgency lists valid values', () => {
      expect(() => {
        sendCable(tmpDir, 'src-auth', 'fyi', 'test', { urgency: 'critical' });
      }).toThrow(/critical/);
      expect(() => {
        sendCable(tmpDir, 'src-auth', 'fyi', 'test', { urgency: 'critical' });
      }).toThrow(/high, normal, low/);
    });
  });

  describe('create command validation errors', () => {
    beforeEach(() => setupProject(tmpDir));

    it('duplicate angel ID names the existing angel', async () => {
      await expect(createAngel(tmpDir, 'src/auth')).rejects.toThrow(/src-auth/);
      await expect(createAngel(tmpDir, 'src/auth')).rejects.toThrow(/already exists/);
    });

    it('non-existent folder names the resolved path', async () => {
      await expect(createAngel(tmpDir, 'src/nonexistent')).rejects.toThrow(/nonexistent/);
      await expect(createAngel(tmpDir, 'src/nonexistent')).rejects.toThrow(/does not exist/);
    });

    it('root path gives actionable error', async () => {
      await expect(createAngel(tmpDir, '.')).rejects.toThrow(/angels init/);
    });
  });

  describe('execute command error messages', () => {
    beforeEach(() => setupProject(tmpDir));

    it('missing brief file names the path', async () => {
      const fakeBriefPath = join(tmpDir, '.angels', '_briefs', 'src-auth', 'nonexistent.md');
      await expect(executeAngel(tmpDir, 'src-auth', fakeBriefPath)).rejects.toThrow(/nonexistent\.md/);
      await expect(executeAngel(tmpDir, 'src-auth', fakeBriefPath)).rejects.toThrow(/Failed to parse brief/);
    });
  });

  describe('newspaper --since validation', () => {
    beforeEach(() => setupProject(tmpDir));

    it('invalid timestamp includes the bad value and expected format', () => {
      expect(() => showNewspaper(tmpDir, { since: 'not-a-date' })).toThrow(/not-a-date/);
      expect(() => showNewspaper(tmpDir, { since: 'not-a-date' })).toThrow(/ISO 8601/);
    });
  });

  describe('config validation errors', () => {
    it('malformed YAML names the config file', () => {
      const angelsDir = join(tmpDir, '.angels');
      fs.mkdirSync(angelsDir, { recursive: true });
      fs.writeFileSync(join(angelsDir, '_config.yml'), '{ invalid yaml: [', 'utf-8');

      expect(() => listAngels(tmpDir)).toThrow(/_config\.yml/);
      expect(() => listAngels(tmpDir)).toThrow(/YAML/i);
    });

    it('schema violation lists the offending field', () => {
      const angelsDir = join(tmpDir, '.angels');
      fs.mkdirSync(angelsDir, { recursive: true });
      fs.writeFileSync(
        join(angelsDir, '_config.yml'),
        yamlStringify({
          version: 1,
          backend: { angel_cmd: 'echo test', angel_timeout_seconds: -5 },
          angels: [{ id: '_root', type: 'root', path: '.' }],
        }, { lineWidth: 0 }),
        'utf-8',
      );

      expect(() => listAngels(tmpDir)).toThrow(/angel_timeout_seconds/);
    });
  });
});
