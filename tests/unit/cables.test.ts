import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  writeCable,
  readInbox,
  parseCableContent,
  type CableData,
} from '../../src/messaging/cables.js';

function makeCable(overrides: Partial<CableData> = {}): CableData {
  return {
    from: 'src-api',
    to: 'src-auth',
    timestamp: '2026-04-28T15:00:00Z',
    type: 'breaking_change',
    urgency: 'high',
    subject: 'Session API signature changed',
    requiresAck: true,
    body: 'The session.create() function now requires a config object instead of positional args.',
    references: ['src/api/session.ts:42', 'src/api/session.ts:87'],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cables-test-'));
  // Create .angels directory structure
  fs.mkdirSync(path.join(tmpDir, '.angels', '_inbox'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.angels', '_outbox'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeCable', () => {
  it('creates files in both outbox and inbox', () => {
    const data = makeCable();
    const filename = writeCable(tmpDir, data);

    expect(filename).toMatch(/\.md$/);

    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const inboxPath = path.join(
      tmpDir, '.angels', '_inbox', 'src-auth', filename,
    );

    expect(fs.existsSync(outboxPath)).toBe(true);
    expect(fs.existsSync(inboxPath)).toBe(true);

    // Content should be identical
    const outboxContent = fs.readFileSync(outboxPath, 'utf-8');
    const inboxContent = fs.readFileSync(inboxPath, 'utf-8');
    expect(outboxContent).toBe(inboxContent);
  });

  it('formats cable content according to spec', () => {
    const data = makeCable();
    const filename = writeCable(tmpDir, data);

    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const content = fs.readFileSync(outboxPath, 'utf-8');

    expect(content).toContain('FROM: src-api');
    expect(content).toContain('TO: src-auth');
    expect(content).toContain('TIMESTAMP: 2026-04-28T15:00:00Z');
    expect(content).toContain('TYPE: breaking_change');
    expect(content).toContain('URGENCY: high');
    expect(content).toContain('SUBJECT: Session API signature changed');
    expect(content).toContain('REQUIRES_ACK: true');
    expect(content).toContain('BODY:');
    expect(content).toContain('session.create()');
    expect(content).toContain('REFERENCES:');
    expect(content).toContain('- src/api/session.ts:42');
    expect(content).toContain('- src/api/session.ts:87');
  });

  it('creates directories automatically', () => {
    // Use a fresh project root with no pre-created dirs
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cables-fresh-'));
    try {
      const data = makeCable();
      writeCable(freshDir, data);

      const outboxDir = path.join(freshDir, '.angels', '_outbox', 'src-api');
      const inboxDir = path.join(freshDir, '.angels', '_inbox', 'src-auth');
      expect(fs.existsSync(outboxDir)).toBe(true);
      expect(fs.existsSync(inboxDir)).toBe(true);
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('throws on invalid TYPE', () => {
    const data = makeCable({ type: 'invalid' as CableData['type'] });
    expect(() => writeCable(tmpDir, data)).toThrow('Invalid cable TYPE');
  });

  it('throws on invalid URGENCY', () => {
    const data = makeCable({ urgency: 'critical' as CableData['urgency'] });
    expect(() => writeCable(tmpDir, data)).toThrow('Invalid cable URGENCY');
  });

  it('throws on missing FROM', () => {
    const data = makeCable({ from: '' });
    expect(() => writeCable(tmpDir, data)).toThrow('Cable FROM is required');
  });

  it('throws on missing TO', () => {
    const data = makeCable({ to: '' });
    expect(() => writeCable(tmpDir, data)).toThrow('Cable TO is required');
  });

  it('throws on missing SUBJECT', () => {
    const data = makeCable({ subject: '' });
    expect(() => writeCable(tmpDir, data)).toThrow('Cable SUBJECT is required');
  });

  it('handles empty references array', () => {
    const data = makeCable({ references: [] });
    const filename = writeCable(tmpDir, data);

    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const content = fs.readFileSync(outboxPath, 'utf-8');
    expect(content).toContain('REFERENCES:');
    // No bullet points after REFERENCES:
    expect(content).not.toContain('- ');
  });

  it('generates unique filenames with sender slug', () => {
    const data = makeCable();
    const filename = writeCable(tmpDir, data);
    expect(filename).toContain('cable-from-src-api');
    expect(filename).toMatch(/^2026-04-28T15-00-00Z-cable-from-src-api\.md$/);
  });
});

describe('parseCableContent', () => {
  it('round-trips through write and parse', () => {
    const data = makeCable();
    const filename = writeCable(tmpDir, data);

    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const raw = fs.readFileSync(outboxPath, 'utf-8');
    const parsed = parseCableContent(raw);

    expect(parsed.from).toBe('src-api');
    expect(parsed.to).toBe('src-auth');
    expect(parsed.timestamp).toBe('2026-04-28T15:00:00Z');
    expect(parsed.type).toBe('breaking_change');
    expect(parsed.urgency).toBe('high');
    expect(parsed.subject).toBe('Session API signature changed');
    expect(parsed.requiresAck).toBe(true);
    expect(parsed.body).toContain('session.create()');
    expect(parsed.references).toEqual([
      'src/api/session.ts:42',
      'src/api/session.ts:87',
    ]);
    expect(parsed.rawContent).toBe(raw);
  });

  it('parses all four cable types', () => {
    const types = ['breaking_change', 'fyi', 'review_request', 'invariant_violation'] as const;
    for (const type of types) {
      const data = makeCable({ type });
      const filename = writeCable(tmpDir, data);
      const outboxPath = path.join(
        tmpDir, '.angels', '_outbox', 'src-api', filename,
      );
      const raw = fs.readFileSync(outboxPath, 'utf-8');
      const parsed = parseCableContent(raw);
      expect(parsed.type).toBe(type);
    }
  });

  it('parses all three urgency levels', () => {
    const urgencies = ['high', 'normal', 'low'] as const;
    for (const urgency of urgencies) {
      const data = makeCable({
        urgency,
        timestamp: `2026-04-28T15:0${urgencies.indexOf(urgency)}:00Z`,
      });
      const filename = writeCable(tmpDir, data);
      const outboxPath = path.join(
        tmpDir, '.angels', '_outbox', 'src-api', filename,
      );
      const raw = fs.readFileSync(outboxPath, 'utf-8');
      const parsed = parseCableContent(raw);
      expect(parsed.urgency).toBe(urgency);
    }
  });

  it('parses REQUIRES_ACK: false', () => {
    const data = makeCable({ requiresAck: false });
    const filename = writeCable(tmpDir, data);
    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const raw = fs.readFileSync(outboxPath, 'utf-8');
    const parsed = parseCableContent(raw);
    expect(parsed.requiresAck).toBe(false);
  });

  it('throws on missing required field', () => {
    const raw = `TO: src-auth\nTIMESTAMP: 2026-04-28T15:00:00Z\n`;
    expect(() => parseCableContent(raw)).toThrow('Missing required field "FROM"');
  });

  it('throws on invalid TYPE', () => {
    const raw = [
      'FROM: src-api',
      'TO: src-auth',
      'TIMESTAMP: 2026-04-28T15:00:00Z',
      'TYPE: danger',
      'URGENCY: high',
      'SUBJECT: Test',
      'REQUIRES_ACK: true',
      '',
      'BODY:',
      'test',
      '',
      'REFERENCES:',
      '',
    ].join('\n');
    expect(() => parseCableContent(raw)).toThrow('Invalid TYPE value');
  });

  it('throws on invalid URGENCY', () => {
    const raw = [
      'FROM: src-api',
      'TO: src-auth',
      'TIMESTAMP: 2026-04-28T15:00:00Z',
      'TYPE: fyi',
      'URGENCY: critical',
      'SUBJECT: Test',
      'REQUIRES_ACK: true',
      '',
      'BODY:',
      'test',
      '',
      'REFERENCES:',
      '',
    ].join('\n');
    expect(() => parseCableContent(raw)).toThrow('Invalid URGENCY value');
  });

  it('throws on invalid REQUIRES_ACK', () => {
    const raw = [
      'FROM: src-api',
      'TO: src-auth',
      'TIMESTAMP: 2026-04-28T15:00:00Z',
      'TYPE: fyi',
      'URGENCY: normal',
      'SUBJECT: Test',
      'REQUIRES_ACK: maybe',
      '',
      'BODY:',
      'test',
      '',
      'REFERENCES:',
      '',
    ].join('\n');
    expect(() => parseCableContent(raw)).toThrow('Invalid REQUIRES_ACK value');
  });

  it('handles empty BODY', () => {
    const data = makeCable({ body: '' });
    const filename = writeCable(tmpDir, data);
    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const raw = fs.readFileSync(outboxPath, 'utf-8');
    const parsed = parseCableContent(raw);
    expect(parsed.body).toBe('');
  });

  it('handles empty references', () => {
    const data = makeCable({ references: [] });
    const filename = writeCable(tmpDir, data);
    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    const raw = fs.readFileSync(outboxPath, 'utf-8');
    const parsed = parseCableContent(raw);
    expect(parsed.references).toEqual([]);
  });
});

describe('readInbox', () => {
  it('returns empty array when inbox directory does not exist', () => {
    const cables = readInbox(tmpDir, 'nonexistent-angel');
    expect(cables).toEqual([]);
  });

  it('returns empty array when inbox is empty', () => {
    fs.mkdirSync(path.join(tmpDir, '.angels', '_inbox', 'src-auth'), {
      recursive: true,
    });
    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toEqual([]);
  });

  it('reads a single cable from inbox', () => {
    writeCable(tmpDir, makeCable());
    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(1);
    expect(cables[0].from).toBe('src-api');
    expect(cables[0].to).toBe('src-auth');
    expect(cables[0].type).toBe('breaking_change');
    expect(cables[0].urgency).toBe('high');
    expect(cables[0].subject).toBe('Session API signature changed');
  });

  it('returns cables sorted by timestamp ascending', () => {
    writeCable(tmpDir, makeCable({
      timestamp: '2026-04-28T16:00:00Z',
      subject: 'Later cable',
    }));
    writeCable(tmpDir, makeCable({
      timestamp: '2026-04-28T14:00:00Z',
      subject: 'Earlier cable',
    }));
    writeCable(tmpDir, makeCable({
      timestamp: '2026-04-28T15:00:00Z',
      subject: 'Middle cable',
    }));

    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(3);
    expect(cables[0].subject).toBe('Earlier cable');
    expect(cables[1].subject).toBe('Middle cable');
    expect(cables[2].subject).toBe('Later cable');
  });

  it('skips non-.md files in inbox', () => {
    writeCable(tmpDir, makeCable());
    // Add a non-.md file
    const inDir = path.join(tmpDir, '.angels', '_inbox', 'src-auth');
    fs.writeFileSync(path.join(inDir, 'notes.txt'), 'not a cable', 'utf-8');

    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(1);
  });

  it('quarantines malformed cable files instead of throwing', () => {
    writeCable(tmpDir, makeCable());
    // Add a malformed .md file
    const inDir = path.join(tmpDir, '.angels', '_inbox', 'src-auth');
    const badPath = path.join(inDir, 'bad-cable.md');
    fs.writeFileSync(badPath, 'this is not a valid cable', 'utf-8');

    // Should not throw; malformed file gets quarantined
    const cables = readInbox(tmpDir, 'src-auth');
    // Only the valid cable is returned
    expect(cables).toHaveLength(1);
    // Malformed file moved to quarantine, no longer in inbox
    expect(fs.existsSync(badPath)).toBe(false);
    expect(
      fs.existsSync(path.join(inDir, '_quarantine', 'bad-cable.md')),
    ).toBe(true);
  });

  it('reads multiple cables from different senders', () => {
    writeCable(tmpDir, makeCable({
      from: 'src-api',
      timestamp: '2026-04-28T15:00:00Z',
      subject: 'From API',
    }));
    writeCable(tmpDir, makeCable({
      from: '_root',
      timestamp: '2026-04-28T15:01:00Z',
      subject: 'From root',
    }));

    const cables = readInbox(tmpDir, 'src-auth');
    expect(cables).toHaveLength(2);
    expect(cables[0].from).toBe('src-api');
    expect(cables[1].from).toBe('_root');
  });
});

describe('integration: cables → prompt builder InboxEntry', () => {
  it('ParsedCable fields map to InboxEntry', () => {
    // Verify that ParsedCable has the fields needed by InboxEntry
    writeCable(tmpDir, makeCable({
      urgency: 'high',
      subject: 'Breaking change',
    }));
    const cables = readInbox(tmpDir, 'src-auth');
    const cable = cables[0];

    // InboxEntry requires: urgency, subject, content
    const inboxEntry = {
      urgency: cable.urgency,
      subject: cable.subject,
      content: cable.rawContent,
    };

    expect(inboxEntry.urgency).toBe('high');
    expect(inboxEntry.subject).toBe('Breaking change');
    expect(typeof inboxEntry.content).toBe('string');
    expect(inboxEntry.content.length).toBeGreaterThan(0);
  });
});
