import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  angelsRoot,
  configFile,
  newspaperFile,
  briefsDir,
  responsesDir,
  inboxDir,
  outboxDir,
  locksDir,
  logsDir,
  cursorsDir,
  archiveDir,
  rootAngelDir,
  angelDir,
  angelMdFile,
  angelBriefsDir,
  angelResponsesDir,
  angelInboxDir,
  angelOutboxDir,
  angelLogsDir,
  angelCursorFile,
} from '../../src/paths/layout.js';
import {
  angelIdToPath,
  pathToAngelId,
  isRootAngel,
} from '../../src/paths/resolve.js';

const ROOT = '/projects/my-app';

describe('layout', () => {
  it('angelsRoot returns .angels under project root', () => {
    expect(angelsRoot(ROOT)).toBe(join(ROOT, '.angels'));
  });

  it('configFile returns _config.yml path', () => {
    expect(configFile(ROOT)).toBe(join(ROOT, '.angels', '_config.yml'));
  });

  it('newspaperFile returns _newspaper.md path', () => {
    expect(newspaperFile(ROOT)).toBe(join(ROOT, '.angels', '_newspaper.md'));
  });

  it('briefsDir returns _briefs path', () => {
    expect(briefsDir(ROOT)).toBe(join(ROOT, '.angels', '_briefs'));
  });

  it('responsesDir returns _responses path', () => {
    expect(responsesDir(ROOT)).toBe(join(ROOT, '.angels', '_responses'));
  });

  it('inboxDir returns _inbox path', () => {
    expect(inboxDir(ROOT)).toBe(join(ROOT, '.angels', '_inbox'));
  });

  it('outboxDir returns _outbox path', () => {
    expect(outboxDir(ROOT)).toBe(join(ROOT, '.angels', '_outbox'));
  });

  it('locksDir returns _locks path', () => {
    expect(locksDir(ROOT)).toBe(join(ROOT, '.angels', '_locks'));
  });

  it('logsDir returns _logs path', () => {
    expect(logsDir(ROOT)).toBe(join(ROOT, '.angels', '_logs'));
  });

  it('cursorsDir returns _cursors path', () => {
    expect(cursorsDir(ROOT)).toBe(join(ROOT, '.angels', '_cursors'));
  });

  it('archiveDir returns _archive path', () => {
    expect(archiveDir(ROOT)).toBe(join(ROOT, '.angels', '_archive'));
  });

  it('rootAngelDir returns _root path', () => {
    expect(rootAngelDir(ROOT)).toBe(join(ROOT, '.angels', '_root'));
  });

  it('angelDir returns the mirrored path under .angels/', () => {
    expect(angelDir(ROOT, 'src/auth')).toBe(join(ROOT, '.angels', 'src', 'auth'));
  });

  it('angelMdFile returns angel.md inside the mirrored path', () => {
    expect(angelMdFile(ROOT, 'src/auth')).toBe(join(ROOT, '.angels', 'src', 'auth', 'angel.md'));
  });

  it('angelBriefsDir returns _briefs/<angel-id>', () => {
    expect(angelBriefsDir(ROOT, 'src-auth')).toBe(join(ROOT, '.angels', '_briefs', 'src-auth'));
  });

  it('angelResponsesDir returns _responses/<angel-id>', () => {
    expect(angelResponsesDir(ROOT, 'src-auth')).toBe(join(ROOT, '.angels', '_responses', 'src-auth'));
  });

  it('angelInboxDir returns _inbox/<angel-id>', () => {
    expect(angelInboxDir(ROOT, 'src-auth')).toBe(join(ROOT, '.angels', '_inbox', 'src-auth'));
  });

  it('angelOutboxDir returns _outbox/<angel-id>', () => {
    expect(angelOutboxDir(ROOT, 'src-auth')).toBe(join(ROOT, '.angels', '_outbox', 'src-auth'));
  });

  it('angelLogsDir returns _logs/<angel-id>', () => {
    expect(angelLogsDir(ROOT, 'src-auth')).toBe(join(ROOT, '.angels', '_logs', 'src-auth'));
  });

  it('angelCursorFile returns _cursors/<angel-id>', () => {
    expect(angelCursorFile(ROOT, 'src-auth')).toBe(join(ROOT, '.angels', '_cursors', 'src-auth'));
  });
});

describe('angelIdToPath', () => {
  it('converts _root to .', () => {
    expect(angelIdToPath('_root')).toBe('.');
  });

  it('converts simple angel ID to path', () => {
    expect(angelIdToPath('src-auth')).toBe('src/auth');
  });

  it('converts deeply nested angel ID', () => {
    expect(angelIdToPath('src-api-v2-handlers')).toBe('src/api/v2/handlers');
  });

  it('converts single-segment angel ID', () => {
    expect(angelIdToPath('lib')).toBe('lib');
  });

  it('converts angel ID with escaped hyphens (double-dash)', () => {
    expect(angelIdToPath('src-my--component')).toBe('src/my-component');
  });

  it('converts angel ID with multiple escaped hyphens', () => {
    expect(angelIdToPath('src-my--cool--component')).toBe('src/my-cool-component');
  });

  it('throws on empty string', () => {
    expect(() => angelIdToPath('')).toThrow('non-empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => angelIdToPath('   ')).toThrow('non-empty');
  });

  it('converts angel ID ending with escaped hyphen', () => {
    expect(angelIdToPath('src-utils--')).toBe('src/utils-');
  });

  it('converts angel ID with adjacent escaped hyphens and separator', () => {
    expect(angelIdToPath('my--app-auth')).toBe('my-app/auth');
  });

  it('throws on angel ID containing slashes', () => {
    expect(() => angelIdToPath('src/auth')).toThrow('slashes');
  });
});

describe('pathToAngelId', () => {
  it('converts . to _root', () => {
    expect(pathToAngelId('.')).toBe('_root');
  });

  it('converts simple path to angel ID', () => {
    expect(pathToAngelId('src/auth')).toBe('src-auth');
  });

  it('converts deeply nested path', () => {
    expect(pathToAngelId('src/api/v2/handlers')).toBe('src-api-v2-handlers');
  });

  it('converts single-segment path', () => {
    expect(pathToAngelId('lib')).toBe('lib');
  });

  it('normalizes trailing slashes', () => {
    expect(pathToAngelId('src/auth/')).toBe('src-auth');
  });

  it('normalizes leading slashes', () => {
    expect(pathToAngelId('/src/auth')).toBe('src-auth');
  });

  it('normalizes duplicate slashes', () => {
    expect(pathToAngelId('src//auth')).toBe('src-auth');
  });

  it('normalizes empty-looking paths to _root', () => {
    expect(pathToAngelId('/')).toBe('_root');
  });

  it('handles paths with hyphens in segment names', () => {
    expect(pathToAngelId('src/my-component')).toBe('src-my--component');
  });

  it('handles paths with multiple hyphens in segment names', () => {
    expect(pathToAngelId('src/my-cool-component')).toBe('src-my--cool--component');
  });

  it('handles paths where multiple segments have hyphens', () => {
    expect(pathToAngelId('my-app/my-component')).toBe('my--app-my--component');
  });

  it('throws on segment consisting entirely of hyphens', () => {
    expect(() => pathToAngelId('src/-/auth')).toThrow('consists entirely of hyphens');
  });

  it('throws on segment that is double-hyphen', () => {
    expect(() => pathToAngelId('src/--/auth')).toThrow('consists entirely of hyphens');
  });

  it('throws on single-segment path that is just a hyphen', () => {
    expect(() => pathToAngelId('-')).toThrow('consists entirely of hyphens');
  });

  it('throws on empty string', () => {
    expect(() => pathToAngelId('')).toThrow('non-empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => pathToAngelId('   ')).toThrow('non-empty');
  });
});

describe('isRootAngel', () => {
  it('returns true for _root', () => {
    expect(isRootAngel('_root')).toBe(true);
  });

  it('returns false for non-root IDs', () => {
    expect(isRootAngel('src-auth')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRootAngel('')).toBe(false);
  });
});

describe('round-trip: pathToAngelId <-> angelIdToPath', () => {
  it('round-trips . (root)', () => {
    const id = pathToAngelId('.');
    expect(angelIdToPath(id)).toBe('.');
  });

  it('round-trips src/auth', () => {
    const id = pathToAngelId('src/auth');
    expect(angelIdToPath(id)).toBe('src/auth');
  });

  it('round-trips src/api/v2/handlers', () => {
    const id = pathToAngelId('src/api/v2/handlers');
    expect(angelIdToPath(id)).toBe('src/api/v2/handlers');
  });

  it('round-trips src/my-component (hyphen in segment)', () => {
    const id = pathToAngelId('src/my-component');
    expect(angelIdToPath(id)).toBe('src/my-component');
  });

  it('round-trips my-app/my-cool-component (hyphens in multiple segments)', () => {
    const id = pathToAngelId('my-app/my-cool-component');
    expect(angelIdToPath(id)).toBe('my-app/my-cool-component');
  });

  it('round-trips single segment with hyphen', () => {
    const id = pathToAngelId('my-lib');
    expect(angelIdToPath(id)).toBe('my-lib');
  });
});
