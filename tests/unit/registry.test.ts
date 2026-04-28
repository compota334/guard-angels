import { describe, it, expect } from 'vitest';
import { AngelRegistry } from '../../src/angels/registry.js';
import type { Config } from '../../src/config/schema.js';

function makeConfig(angels: Config['angels']): Config {
  return {
    version: 1,
    backend: {
      angel_cmd: 'echo test',
      angel_timeout_seconds: 60,
    },
    angels,
    sweep: {
      autonomy: 'report-only',
    },
  };
}

describe('AngelRegistry', () => {
  describe('fromConfig - happy path', () => {
    it('creates a registry from a valid config', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
        { id: 'src-api', type: 'folder', path: 'src/api' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      expect(registry.listAll()).toHaveLength(3);
    });

    it('creates a registry with only the root angel', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      expect(registry.listAll()).toHaveLength(1);
    });
  });

  describe('getById', () => {
    it('returns the angel entry for a valid id', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      const angel = registry.getById('src-auth');
      expect(angel.id).toBe('src-auth');
      expect(angel.type).toBe('folder');
      expect(angel.path).toBe('src/auth');
    });

    it('throws for a non-existent id', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      expect(() => registry.getById('nonexistent')).toThrow(
        'Angel not found with id "nonexistent"',
      );
    });
  });

  describe('getRoot', () => {
    it('returns the root angel', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      const root = registry.getRoot();
      expect(root.id).toBe('_root');
      expect(root.type).toBe('root');
      expect(root.path).toBe('.');
    });
  });

  describe('getByPath', () => {
    it('returns the angel entry for a valid path', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      const angel = registry.getByPath('src/auth');
      expect(angel.id).toBe('src-auth');
    });

    it('returns root angel when looking up "."', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      const angel = registry.getByPath('.');
      expect(angel.id).toBe('_root');
    });

    it('throws for a non-existent path', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      expect(() => registry.getByPath('nonexistent')).toThrow(
        'Angel not found with path "nonexistent"',
      );
    });
  });

  describe('listAll', () => {
    it('returns all angels in config order', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
        { id: 'src-api', type: 'folder', path: 'src/api' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      const all = registry.listAll();
      expect(all[0]!.id).toBe('_root');
      expect(all[1]!.id).toBe('src-auth');
      expect(all[2]!.id).toBe('src-api');
    });

    it('returns a readonly array', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
      ]);
      const registry = AngelRegistry.fromConfig(config);
      const all = registry.listAll();
      // Verify it's the same reference on repeated calls
      expect(registry.listAll()).toBe(all);
    });
  });

  describe('validation - duplicate id', () => {
    it('throws on duplicate angel IDs', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
        { id: 'src-auth', type: 'folder', path: 'src/other' },
      ]);
      expect(() => AngelRegistry.fromConfig(config)).toThrow(
        'Duplicate angel ID "src-auth"',
      );
    });
  });

  describe('validation - duplicate path', () => {
    it('throws on duplicate angel paths', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
        { id: 'src-auth-v2', type: 'folder', path: 'src/auth' },
      ]);
      expect(() => AngelRegistry.fromConfig(config)).toThrow(
        'Duplicate angel path "src/auth"',
      );
    });
  });

  describe('validation - missing root', () => {
    it('throws when no root angel exists', () => {
      const config = makeConfig([
        { id: 'src-auth', type: 'folder', path: 'src/auth' },
      ]);
      expect(() => AngelRegistry.fromConfig(config)).toThrow(
        'No root angel found',
      );
    });
  });

  describe('validation - root angel constraints', () => {
    it('throws when root angel has wrong id', () => {
      const config = makeConfig([
        { id: 'wrong-root', type: 'root', path: '.' },
      ]);
      expect(() => AngelRegistry.fromConfig(config)).toThrow(
        'Root angel must have id "_root", got "wrong-root"',
      );
    });

    it('throws when root angel has wrong path', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: 'src' },
      ]);
      expect(() => AngelRegistry.fromConfig(config)).toThrow(
        'Root angel must have path ".", got "src"',
      );
    });

    it('throws when multiple root angels exist', () => {
      const config = makeConfig([
        { id: '_root', type: 'root', path: '.' },
        { id: '_root2', type: 'root', path: 'other' },
      ]);
      expect(() => AngelRegistry.fromConfig(config)).toThrow(
        'Multiple root angels found',
      );
    });
  });
});
