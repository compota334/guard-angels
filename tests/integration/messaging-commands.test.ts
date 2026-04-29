import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { sendCable } from '../../src/commands/cable.js';
import { showInbox } from '../../src/commands/inbox.js';
import { showNewspaper } from '../../src/commands/newspaper.js';
import { appendNewspaper } from '../../src/messaging/newspaper.js';
import { readInbox } from '../../src/messaging/cables.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-msg-cmds-'));
  setupProject(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('angels cable', () => {
  it('sends a cable from _root to src-auth and creates both inbox and outbox files', () => {
    sendCable(tmpDir, 'src-auth', 'fyi', 'New config format adopted', {
      subject: 'Config format change',
    });

    // Verify cable landed in inbox
    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(1);
    expect(cables[0].from).toBe('_root');
    expect(cables[0].to).toBe('src-auth');
    expect(cables[0].type).toBe('fyi');
    expect(cables[0].subject).toBe('Config format change');
    expect(cables[0].body).toBe('New config format adopted');
    expect(cables[0].urgency).toBe('normal');
    expect(cables[0].requiresAck).toBe(false);

    // Verify outbox also has a file
    const outboxDir = join(tmpDir, '.angels', '_outbox', '_root');
    const outboxFiles = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.md'));
    expect(outboxFiles).toHaveLength(1);
  });

  it('sends a high-urgency cable with requiresAck=true', () => {
    sendCable(tmpDir, 'src-auth', 'breaking_change', 'API endpoint removed', {
      urgency: 'high',
      subject: 'Breaking: /users endpoint removed',
    });

    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(1);
    expect(cables[0].urgency).toBe('high');
    expect(cables[0].requiresAck).toBe(true);
  });

  it('allows specifying a sender with --from', () => {
    sendCable(tmpDir, '_root', 'fyi', 'Auth module updated', {
      from: 'src-auth',
    });

    const cables = readInbox(tmpDir, '_root');
    expect(cables).toHaveLength(1);
    expect(cables[0].from).toBe('src-auth');
  });

  it('throws on non-existent recipient angel', () => {
    expect(() => {
      sendCable(tmpDir, 'nonexistent', 'fyi', 'Hello');
    }).toThrow(/nonexistent/);
  });

  it('throws on non-existent sender angel', () => {
    expect(() => {
      sendCable(tmpDir, 'src-auth', 'fyi', 'Hello', { from: 'bad-sender' });
    }).toThrow(/bad-sender/);
  });

  it('throws on invalid cable type', () => {
    expect(() => {
      sendCable(tmpDir, 'src-auth', 'invalid_type', 'Hello');
    }).toThrow(/invalid_type/);
  });

  it('throws on invalid urgency', () => {
    expect(() => {
      sendCable(tmpDir, 'src-auth', 'fyi', 'Hello', { urgency: 'critical' });
    }).toThrow(/critical/);
  });

  it('auto-generates subject from body when not provided', () => {
    sendCable(tmpDir, 'src-auth', 'fyi', 'This is a long body that should be truncated for the subject line');

    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(1);
    expect(cables[0].subject).toBe('This is a long body that should be truncated for the subject');
  });
});

describe('angels inbox', () => {
  it('prints pending cables for an angel', () => {
    // Send two cables to src-auth
    sendCable(tmpDir, 'src-auth', 'fyi', 'First message', {
      subject: 'First cable',
    });
    sendCable(tmpDir, 'src-auth', 'breaking_change', 'Second message', {
      subject: 'Second cable',
      urgency: 'high',
    });

    // Capture console output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      showInbox(tmpDir, 'src-auth');
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('Pending cables for angel "src-auth" (2)');
    expect(output).toContain('First cable');
    expect(output).toContain('Second cable');
    expect(output).toContain('[HIGH]');
    expect(output).toContain('From: _root');
  });

  it('prints empty message when no cables pending', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      showInbox(tmpDir, 'src-auth');
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('No pending cables');
  });

  it('throws for non-existent angel id', () => {
    expect(() => {
      showInbox(tmpDir, 'nonexistent');
    }).toThrow(/nonexistent/);
  });
});

describe('angels newspaper', () => {
  it('prints all newspaper entries', () => {
    // Append some entries
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T10:00:00Z',
      angelId: 'src-auth',
      summary: 'EXECUTE completed successfully',
      details: 'Files changed: session.ts',
    });
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T11:00:00Z',
      angelId: '_root',
      summary: 'Config updated',
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      showNewspaper(tmpDir);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('Newspaper entries (2)');
    expect(output).toContain('## 2026-04-28T10:00:00Z [src-auth]');
    expect(output).toContain('EXECUTE completed successfully');
    expect(output).toContain('## 2026-04-28T11:00:00Z [_root]');
    expect(output).toContain('Config updated');
  });

  it('filters entries with --since', () => {
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T10:00:00Z',
      angelId: 'src-auth',
      summary: 'Old entry',
    });
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T14:00:00Z',
      angelId: '_root',
      summary: 'New entry',
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      showNewspaper(tmpDir, { since: '2026-04-28T12:00:00Z' });
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('Newspaper entries (1)');
    expect(output).not.toContain('Old entry');
    expect(output).toContain('New entry');
  });

  it('prints empty message when no entries', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      showNewspaper(tmpDir);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('No newspaper entries');
  });

  it('prints empty message when --since filters out all entries', () => {
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T10:00:00Z',
      angelId: 'src-auth',
      summary: 'Old entry',
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      showNewspaper(tmpDir, { since: '2026-04-29T00:00:00Z' });
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('No newspaper entries since');
  });

  it('throws on malformed --since timestamp', () => {
    appendNewspaper(tmpDir, {
      timestamp: '2026-04-28T10:00:00Z',
      angelId: 'src-auth',
      summary: 'Some entry',
    });

    expect(() => {
      showNewspaper(tmpDir, { since: 'not-a-date' });
    }).toThrow(/Invalid --since timestamp/);
  });

  it('throws when project is not initialized', () => {
    const uninitDir = fs.mkdtempSync(join(os.tmpdir(), 'guard-angel-uninit-'));
    try {
      expect(() => {
        showNewspaper(uninitDir);
      }).toThrow(/Config file not found/);
    } finally {
      fs.rmSync(uninitDir, { recursive: true, force: true });
    }
  });
});

/**
 * Set up a minimal project with .angels/ structure for command testing.
 */
function setupProject(projectRoot: string): void {
  const angelsDir = join(projectRoot, '.angels');
  fs.mkdirSync(join(angelsDir, '_briefs'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_responses'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_inbox'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_outbox'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_locks'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_logs'), { recursive: true });
  fs.mkdirSync(join(angelsDir, '_cursors'), { recursive: true });

  const config = {
    version: 1,
    backend: {
      angel_cmd: 'echo noop',
      angel_timeout_seconds: 30,
    },
    angels: [
      { id: '_root', type: 'root', path: '.' },
      { id: 'src-auth', type: 'folder', path: 'src/auth' },
      { id: 'src-api', type: 'folder', path: 'src/api' },
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

  // Create _newspaper.md (empty initially)
  fs.writeFileSync(join(angelsDir, '_newspaper.md'), '', 'utf-8');
}
