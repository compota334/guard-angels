import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readAngelMd, writeAngelMd, updateMetadata } from '../../src/angels/memory.js';
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
