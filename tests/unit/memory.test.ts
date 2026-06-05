import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readAngelMd, writeAngelMd, updateMetadata, getAngelMdPath, appendAngelMd, verifyAngelMd } from '../../src/angels/memory.js';
import type { AngelMd, AngelFrontmatter } from '../../src/angels/memory.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function angelPath(): string {
  return path.join(tmpDir, 'angel.md');
}

function writeRaw(content: string): string {
  const p = angelPath();
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

const validFrontmatter: AngelFrontmatter = {
  status: 'active',
  last_updated: '2026-04-28T14:32:00Z',
  last_updated_by: 'main',
};

const validBody = `# Angel: src/auth (folder)

## Charter
Owns authentication logic.

## Public contract
Exports session middleware.
`;

const validFile = `---
status: active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main
---
${validBody}`;

describe('readAngelMd', () => {
  it('parses a valid angel.md with frontmatter and body', () => {
    const p = writeRaw(validFile);
    const result = readAngelMd(p);
    expect(result.frontmatter).toEqual(validFrontmatter);
    expect(result.body).toBe(validBody);
  });

  it('handles draft status', () => {
    const content = `---
status: draft
last_updated: 2026-04-28T10:00:00Z
last_updated_by: sweep
---
Body here.
`;
    const p = writeRaw(content);
    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('draft');
    expect(result.frontmatter.last_updated_by).toBe('sweep');
  });

  it('handles self as last_updated_by', () => {
    const content = `---
status: active
last_updated: 2026-04-28T10:00:00Z
last_updated_by: self
---
Body.
`;
    const p = writeRaw(content);
    const result = readAngelMd(p);
    expect(result.frontmatter.last_updated_by).toBe('self');
  });

  it('handles empty body', () => {
    const content = `---
status: draft
last_updated: 2026-04-28T10:00:00Z
last_updated_by: main
---
`;
    const p = writeRaw(content);
    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('draft');
    expect(result.body).toBe('');
  });

  it('throws on missing file', () => {
    expect(() => readAngelMd(path.join(tmpDir, 'nonexistent.md'))).toThrow(
      /Cannot read angel\.md/,
    );
  });

  it('throws on missing frontmatter opening', () => {
    const p = writeRaw('No frontmatter here.\n');
    expect(() => readAngelMd(p)).toThrow(/Missing YAML frontmatter/);
  });

  it('throws on missing frontmatter closing', () => {
    const p = writeRaw('---\nstatus: active\n');
    expect(() => readAngelMd(p)).toThrow(/Malformed YAML frontmatter/);
  });

  it('throws on invalid status value', () => {
    const content = `---
status: unknown
last_updated: 2026-04-28T10:00:00Z
last_updated_by: main
---
Body.
`;
    const p = writeRaw(content);
    expect(() => readAngelMd(p)).toThrow(/Invalid frontmatter/);
  });

  it('throws on missing last_updated field', () => {
    const content = `---
status: active
last_updated_by: main
---
Body.
`;
    const p = writeRaw(content);
    expect(() => readAngelMd(p)).toThrow(/Invalid frontmatter/);
  });

  it('throws on missing last_updated_by field', () => {
    const content = `---
status: active
last_updated: 2026-04-28T10:00:00Z
---
Body.
`;
    const p = writeRaw(content);
    expect(() => readAngelMd(p)).toThrow(/Invalid frontmatter/);
  });

  it('throws on invalid last_updated_by value', () => {
    const content = `---
status: active
last_updated: 2026-04-28T10:00:00Z
last_updated_by: robot
---
Body.
`;
    const p = writeRaw(content);
    expect(() => readAngelMd(p)).toThrow(/Invalid frontmatter/);
  });

  it('handles quoted values in frontmatter', () => {
    const content = `---
status: "active"
last_updated: '2026-04-28T10:00:00Z'
last_updated_by: "main"
---
Body.
`;
    const p = writeRaw(content);
    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.last_updated).toBe('2026-04-28T10:00:00Z');
  });

  it('preserves body content with multiple sections', () => {
    const body = `# Angel: src/api (folder)

## Charter
REST API routes.

## Public contract
Exposes /api/v1 endpoints.

## Invariants
- All routes require auth middleware.
- No direct database access.

## Decision log
2026-04-28: Created initial angel.

## Open questions / known debt
- Rate limiting not implemented.

## Dependencies
- Depends on src-auth for session validation.
`;
    const content = `---
status: active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main
---
${body}`;
    const p = writeRaw(content);
    const result = readAngelMd(p);
    expect(result.body).toBe(body);
  });
});

describe('writeAngelMd', () => {
  it('writes a valid angel.md that round-trips through readAngelMd', () => {
    const p = angelPath();
    const angelMd: AngelMd = {
      frontmatter: validFrontmatter,
      body: validBody,
    };
    writeAngelMd(p, angelMd);
    const result = readAngelMd(p);
    expect(result.frontmatter).toEqual(validFrontmatter);
    expect(result.body).toBe(validBody);
  });

  it('creates parent directories if they do not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir', 'angel.md');
    writeAngelMd(nested, {
      frontmatter: validFrontmatter,
      body: 'Test body.\n',
    });
    const result = readAngelMd(nested);
    expect(result.frontmatter).toEqual(validFrontmatter);
  });

  it('overwrites an existing file atomically', () => {
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: { ...validFrontmatter, status: 'draft' },
      body: 'Original.\n',
    });
    writeAngelMd(p, {
      frontmatter: validFrontmatter,
      body: 'Updated.\n',
    });
    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('active');
    expect(result.body).toBe('Updated.\n');
  });

  it('does not leave tmp files after successful write', () => {
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: validFrontmatter,
      body: 'Test.\n',
    });
    const files = fs.readdirSync(tmpDir);
    const tmpFiles = files.filter((f) => f.startsWith('.angel.md.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('throws on invalid frontmatter for write', () => {
    const p = angelPath();
    expect(() =>
      writeAngelMd(p, {
        frontmatter: { status: 'invalid' as 'draft', last_updated: '', last_updated_by: 'main' },
        body: '',
      }),
    ).toThrow(/Invalid frontmatter for write/);
  });

  it('writes empty body correctly', () => {
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: validFrontmatter,
      body: '',
    });
    const result = readAngelMd(p);
    expect(result.body).toBe('');
  });
});

describe('updateMetadata', () => {
  it('updates status without changing body', () => {
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: { ...validFrontmatter, status: 'draft' },
      body: validBody,
    });
    updateMetadata(p, { status: 'active' });
    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.last_updated_by).toBe('main');
    expect(result.body).toBe(validBody);
  });

  it('updates last_updated and last_updated_by together', () => {
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: validFrontmatter,
      body: validBody,
    });
    updateMetadata(p, {
      last_updated: '2026-05-01T00:00:00Z',
      last_updated_by: 'sweep',
    });
    const result = readAngelMd(p);
    expect(result.frontmatter.last_updated).toBe('2026-05-01T00:00:00Z');
    expect(result.frontmatter.last_updated_by).toBe('sweep');
    expect(result.frontmatter.status).toBe('active');
  });

  it('updates a single field', () => {
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: validFrontmatter,
      body: 'Body.\n',
    });
    updateMetadata(p, { last_updated_by: 'self' });
    const result = readAngelMd(p);
    expect(result.frontmatter.last_updated_by).toBe('self');
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.last_updated).toBe('2026-04-28T14:32:00Z');
  });

  it('throws on non-existent file', () => {
    expect(() =>
      updateMetadata(path.join(tmpDir, 'nonexistent.md'), { status: 'active' }),
    ).toThrow(/Cannot read angel\.md/);
  });

  it('round-trips sweep update (last_updated_by: sweep) without disturbing body', () => {
    const body = `# Angel: src/auth (folder)

## Charter
Owns all authentication and session management.

## Public contract
- createSession(userId: string): Session
- validateToken(token: string): boolean

## Invariants
- All sessions expire after 24 hours
- Tokens are validated server-side only

## Decision log
- 2026-04-28: Initial charter created

## Dependencies
- Depends on: src-db (for session storage)
- Depended on by: src-api (for auth middleware)
`;
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: { status: 'active', last_updated: '2026-04-28T14:32:00Z', last_updated_by: 'main' },
      body,
    });

    // Simulate what a sweep angel does: update metadata to mark sweep as the updater
    updateMetadata(p, {
      last_updated: '2026-04-29T10:00:00Z',
      last_updated_by: 'sweep',
    });

    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.last_updated).toBe('2026-04-29T10:00:00Z');
    expect(result.frontmatter.last_updated_by).toBe('sweep');
    expect(result.body).toBe(body);
  });

  it('round-trips full angel.md rewrite by sweep (body + metadata)', () => {
    const p = angelPath();
    // Initial write by main
    writeAngelMd(p, {
      frontmatter: { status: 'draft', last_updated: '2026-04-28T14:32:00Z', last_updated_by: 'main' },
      body: '# Angel: src/auth (folder)\n\n## Charter\nOriginal charter.\n',
    });

    // Sweep rewrites the entire angel.md (body and metadata)
    const updatedBody = `# Angel: src/auth (folder)

## Charter
Owns all authentication, session management, and token validation.

## Public contract
- createSession(userId: string): Session
- validateToken(token: string): boolean
- revokeSession(sessionId: string): void

## Invariants
- All sessions expire after 24 hours
- Tokens must be validated server-side

## Decision log
- 2026-04-28: Initial charter created
- 2026-04-29: Sweep detected new export revokeSession(), updated charter

## Dependencies
- Depends on: src-db
`;
    writeAngelMd(p, {
      frontmatter: { status: 'active', last_updated: '2026-04-29T10:05:00Z', last_updated_by: 'sweep' },
      body: updatedBody,
    });

    const result = readAngelMd(p);
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.last_updated).toBe('2026-04-29T10:05:00Z');
    expect(result.frontmatter.last_updated_by).toBe('sweep');
    expect(result.body).toBe(updatedBody);
  });

  it('preserves body exactly through metadata update', () => {
    const complexBody = `# Angel: complex (folder)

Some content with special chars: \`backticks\`, **bold**, and --- dashes.

## Section
- Item 1
- Item 2

\`\`\`typescript
const x = "hello";
\`\`\`
`;
    const p = angelPath();
    writeAngelMd(p, {
      frontmatter: validFrontmatter,
      body: complexBody,
    });
    updateMetadata(p, { status: 'draft' });
    const result = readAngelMd(p);
    expect(result.body).toBe(complexBody);
  });
});

describe('getAngelMdPath', () => {
  it('returns path/angel.md for a nested angel path', () => {
    expect(getAngelMdPath('src/auth')).toBe('.angels/src/auth/angel.md');
  });

  it('returns path/angel.md for root angel path (.)', () => {
    expect(getAngelMdPath('.')).toBe('.angels/./angel.md');
  });

  it('returns path/angel.md for a single-segment angel path', () => {
    expect(getAngelMdPath('api')).toBe('.angels/api/angel.md');
  });
});

describe('appendAngelMd', () => {
  let originalCwd: string;
  const testAngelPath = 'src/test-angel';

  beforeEach(() => {
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    // Create the angel.md file inside tmpDir/.angels/src/test-angel/
    const angelDir = path.join(tmpDir, '.angels', testAngelPath);
    fs.mkdirSync(angelDir, { recursive: true });
    const fp = path.join(angelDir, 'angel.md');
    const body = `# Angel: src/test-angel (folder)

## Charter
Owns test-related logic.

## Public contract
Provides test data to other modules.
`;
    writeAngelMd(fp, {
      frontmatter: { status: 'active', last_updated: '2026-04-28T14:32:00Z', last_updated_by: 'main' },
      body,
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('appends bodyChunk to existing angel.md and updates last_updated', () => {
    appendAngelMd(testAngelPath, '## New section\nAppended content.\n');

    // Verify the body was appended
    const fp = path.join(tmpDir, '.angels', testAngelPath, 'angel.md');
    const md = readAngelMd(fp);
    expect(md.body).toContain('## New section');
    expect(md.body).toContain('Appended content.');

    // Verify last_updated was updated to a recent timestamp
    const updated = new Date(md.frontmatter.last_updated).getTime();
    const now = Date.now();
    expect(updated).toBeGreaterThan(new Date('2026-04-28T14:32:00Z').getTime());
    expect(now - updated).toBeLessThan(10_000);
  });

  it('creates a backup in _backups/<angelPath>/ before appending', () => {
    appendAngelMd(testAngelPath, 'Extra content.\n');

    // appendAngelMd constructs backupDir as:
    //   path.join(path.dirname(filePath), '..', '_backups', angelPath)
    // For angelPath='src/test-angel', filePath='.angels/src/test-angel/angel.md'
    // This resolves to .angels/src/_backups/src/test-angel/
    const backupDir = path.join(tmpDir, '.angels', 'src', '_backups', testAngelPath);
    expect(fs.existsSync(backupDir)).toBe(true);

    // Check at least one backup .md file was created
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('returns AppendResult with correct sizes', () => {
    const bodyChunk = '## Extra\n\nMore content.\n';
    const fp = path.join(tmpDir, '.angels', testAngelPath, 'angel.md');
    const beforeStat = fs.statSync(fp);

    const result = appendAngelMd(testAngelPath, bodyChunk);

    expect(result.previousSizeBytes).toBe(beforeStat.size);
    expect(result.newSizeBytes).toBeGreaterThan(beforeStat.size);
    expect(result.appendedChars).toBe(bodyChunk.length);

    // Verify new size matches actual file size after append
    const afterStat = fs.statSync(fp);
    expect(result.newSizeBytes).toBe(afterStat.size);
  });

  it('handles angel.md with no body (empty body after frontmatter)', () => {
    // Create an angel.md with empty body
    const fp = path.join(tmpDir, '.angels', testAngelPath, 'angel.md');
    writeAngelMd(fp, {
      frontmatter: { status: 'draft', last_updated: '2026-04-28T10:00:00Z', last_updated_by: 'self' },
      body: '',
    });

    const bodyChunk = '## New section\nFresh content.\n';
    const result = appendAngelMd(testAngelPath, bodyChunk);

    const md = readAngelMd(fp);
    expect(md.body).toContain('Fresh content.');
    expect(result.previousSizeBytes).toBeGreaterThan(0); // frontmatter is part of raw
  });

  it('throws when the angel.md does not exist', () => {
    expect(() => appendAngelMd('nonexistent/path', 'Some content.\n')).toThrow(
      /Cannot read angel\.md/,
    );
  });
});

describe('verifyAngelMd', () => {
  const longBody = `# Angel: src/test (folder)

## Charter
Owns all test-related functionality and test utilities.

## Public contract
- provides mock data for unit tests
- supplies integration test fixtures
- exports assertion helpers

## Invariants
- Tests must be deterministic
- No external network calls

## Dependencies
- Depends on: src-core
`;
  const shortBody = '# Angel\n\nToo short.';

  it('returns valid: true for a well-formed angel.md', () => {
    const content = `---
status: active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main
---
${longBody}`;
    const p = writeRaw(content);
    const result = verifyAngelMd(p);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.frontmatter).not.toBeNull();
    expect(result.bodyLength).toBeGreaterThanOrEqual(50);
  });

  it('returns issues for a file without frontmatter', () => {
    const p = writeRaw('Plain text without any YAML frontmatter.\n');
    const result = verifyAngelMd(p);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid frontmatter');
    expect(result.frontmatter).toBeNull();
  });

  it('returns valid: true when expectedMinTokens is satisfied', () => {
    const content = `---
status: active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main
---
${longBody}`;
    const p = writeRaw(content);
    // longBody is ~350+ chars, so ~262+ estimated tokens, easily > 50
    const result = verifyAngelMd(p, 50);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('includes a token warning when expectedMinTokens is NOT met', () => {
    const content = `---
status: active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main
---
${shortBody}`;
    const p = writeRaw(content);
    /* shortBody = '# Angel\n\nToo short.' (20 chars trimmed)
       20 * 0.75 = 15 estimated tokens, so expectedMinTokens=100 should fail */
    const result = verifyAngelMd(p, 100);
    expect(result.valid).toBe(false);
    const tokenIssue = result.errors.find((e) => e.startsWith('Body too small'));
    expect(tokenIssue).toBeTruthy();
  });

  it('returns valid: false for a non-existent file', () => {
    const p = path.join(tmpDir, 'does-not-exist.md');
    const result = verifyAngelMd(p);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('File does not exist');
    expect(result.sizeBytes).toBe(0);
    expect(result.frontmatter).toBeNull();
    expect(result.bodyLength).toBe(0);
  });

  it('returns valid: false when body is shorter than 50 characters', () => {
    const content = `---
status: active
last_updated: 2026-04-28T14:32:00Z
last_updated_by: main
---
Short body.`;
    const p = writeRaw(content);
    const result = verifyAngelMd(p);
    expect(result.valid).toBe(false);
    const bodyIssue = result.errors.find((e) => e.startsWith('Body too short'));
    expect(bodyIssue).toBeTruthy();
  });
});
