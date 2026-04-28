import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeCable, readInbox, type CableData } from '../../src/messaging/cables.js';
import { buildPrompt, type PromptInput, type InboxEntry } from '../../src/protocol/prompt.js';

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
    references: ['src/api/session.ts:42'],
    ...overrides,
  };
}

function makePromptInput(inbox: InboxEntry[]): PromptInput {
  return {
    phase: 'review',
    angelId: 'src-auth',
    angelPath: 'src/auth',
    angelType: 'folder',
    folderListing: 'session.ts\nmiddleware.ts',
    angelMd: '---\nstatus: active\nlast_updated: 2026-04-28T14:32:00Z\nlast_updated_by: main\n---\n\n# Angel: src/auth (folder)\n',
    newspaperDelta: '',
    inbox,
    brief: 'TO: src-auth\nFROM: main\nTIMESTAMP: 2026-04-28T15:30:00Z\nPHASE: review\nTYPE: change_request\n\nTASK:\nUpdate session handling\n\nCONTEXT:\nNeeded for new auth flow\n\nEXPECTED SCOPE:\nsession.ts\n\nPRIOR RESPONSE: none\n',
    responsePath: '/project/.angels/_responses/src-auth/2026-04-28T1530-001.md',
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cables-integ-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cable flow: write → inbox → prompt', () => {
  it('a cable written by one angel appears in another angel\'s inbox and prompt', () => {
    // Step 1: src-api sends a high-urgency cable to src-auth
    const cable = makeCable({
      urgency: 'high',
      subject: 'Breaking change in session API',
      body: 'session.create() now requires { config: SessionConfig } instead of (token, expiry).',
    });
    writeCable(tmpDir, cable);

    // Step 2: Read src-auth's inbox
    const inbox = readInbox(tmpDir, 'src-auth');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].from).toBe('src-api');
    expect(inbox[0].urgency).toBe('high');

    // Step 3: Convert to InboxEntry for prompt builder
    const inboxEntries: InboxEntry[] = inbox.map((c) => ({
      urgency: c.urgency,
      subject: c.subject,
      content: c.rawContent,
    }));

    // Step 4: Build a prompt for src-auth and verify the cable shows up
    const prompt = buildPrompt(makePromptInput(inboxEntries));

    // High-urgency: full content is inlined
    expect(prompt).toContain('--- URGENT CABLE ---');
    expect(prompt).toContain('session.create() now requires');
    expect(prompt).toContain('--- END CABLE ---');
    expect(prompt).not.toContain('(no pending cables)');
  });

  it('normal/low urgency cables show subject only in prompt', () => {
    // Send a normal-urgency cable
    writeCable(tmpDir, makeCable({
      urgency: 'normal',
      timestamp: '2026-04-28T15:00:00Z',
      subject: 'New utility function available',
      body: 'A new helper function formatDate() has been added.',
    }));

    // Send a low-urgency cable
    writeCable(tmpDir, makeCable({
      from: '_root',
      urgency: 'low',
      timestamp: '2026-04-28T15:01:00Z',
      subject: 'README updated',
      body: 'The project README has been updated with new installation instructions.',
    }));

    const inbox = readInbox(tmpDir, 'src-auth');
    expect(inbox).toHaveLength(2);

    const inboxEntries: InboxEntry[] = inbox.map((c) => ({
      urgency: c.urgency,
      subject: c.subject,
      content: c.rawContent,
    }));

    const prompt = buildPrompt(makePromptInput(inboxEntries));

    // Normal: subject only
    expect(prompt).toContain('- [normal] New utility function available');
    // Low: subject only
    expect(prompt).toContain('- [low] README updated');
    // Body should NOT be inlined for normal/low
    expect(prompt).not.toContain('formatDate()');
    expect(prompt).not.toContain('new installation instructions');
    // No urgent cable markers
    expect(prompt).not.toContain('--- URGENT CABLE ---');
  });

  it('mixes urgency levels correctly in prompt', () => {
    writeCable(tmpDir, makeCable({
      urgency: 'high',
      timestamp: '2026-04-28T15:00:00Z',
      subject: 'Critical: API breaking change',
      body: 'The /users endpoint now returns paginated results.',
    }));
    writeCable(tmpDir, makeCable({
      from: '_root',
      urgency: 'normal',
      timestamp: '2026-04-28T15:01:00Z',
      subject: 'Config file updated',
      body: 'tsconfig.json strict mode enabled.',
    }));

    const inbox = readInbox(tmpDir, 'src-auth');
    const inboxEntries: InboxEntry[] = inbox.map((c) => ({
      urgency: c.urgency,
      subject: c.subject,
      content: c.rawContent,
    }));

    const prompt = buildPrompt(makePromptInput(inboxEntries));

    // High-urgency: inlined
    expect(prompt).toContain('--- URGENT CABLE ---');
    expect(prompt).toContain('paginated results');
    // Normal: subject only
    expect(prompt).toContain('- [normal] Config file updated');
    expect(prompt).not.toContain('strict mode enabled');
  });

  it('outbox preserves the audit trail independently of inbox', () => {
    const cable = makeCable();
    const filename = writeCable(tmpDir, cable);

    // Verify outbox has the file
    const outboxPath = path.join(
      tmpDir, '.angels', '_outbox', 'src-api', filename,
    );
    expect(fs.existsSync(outboxPath)).toBe(true);

    // Delete the inbox copy
    const inboxPath = path.join(
      tmpDir, '.angels', '_inbox', 'src-auth', filename,
    );
    fs.unlinkSync(inboxPath);

    // Inbox is now empty
    expect(readInbox(tmpDir, 'src-auth')).toHaveLength(0);

    // But outbox still has the audit trail
    expect(fs.existsSync(outboxPath)).toBe(true);
    const outboxContent = fs.readFileSync(outboxPath, 'utf-8');
    expect(outboxContent).toContain('FROM: src-api');
  });
});
