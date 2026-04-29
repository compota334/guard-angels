import type { Config, AngelEntry } from '../config/schema.js';

export class AngelRegistry {
  private readonly byId: Map<string, AngelEntry>;
  private readonly byPath: Map<string, AngelEntry>;
  private readonly root: AngelEntry;
  private readonly entries: ReadonlyArray<AngelEntry>;

  private constructor(angels: AngelEntry[]) {
    this.byId = new Map();
    this.byPath = new Map();
    this.entries = angels;

    let root: AngelEntry | undefined;

    for (const angel of angels) {
      if (this.byId.has(angel.id)) {
        throw new Error(
          `Duplicate angel ID "${angel.id}": each angel must have a unique ID`,
        );
      }
      if (this.byPath.has(angel.path)) {
        throw new Error(
          `Duplicate angel path "${angel.path}": each angel must have a unique path`,
        );
      }

      this.byId.set(angel.id, angel);
      this.byPath.set(angel.path, angel);

      if (angel.type === 'root') {
        if (root !== undefined) {
          throw new Error(
            `Multiple root angels found ("${root.id}" and "${angel.id}"): exactly one root angel (type: root) is required`,
          );
        }
        root = angel;
      }
    }

    if (root === undefined) {
      throw new Error(
        'No root angel found: config must contain exactly one angel with type: root and id: _root',
      );
    }

    if (root.id !== '_root') {
      throw new Error(
        `Root angel must have id "_root", got "${root.id}"`,
      );
    }

    if (root.path !== '.') {
      throw new Error(
        `Root angel must have path ".", got "${root.path}"`,
      );
    }

    this.root = root;
  }

  static fromConfig(config: Config): AngelRegistry {
    return new AngelRegistry(config.angels);
  }

  getById(id: string): AngelEntry {
    const entry = this.byId.get(id);
    if (entry === undefined) {
      const available = [...this.byId.keys()].join(', ');
      throw new Error(
        `Angel not found with id "${id}". Registered angels: ${available || '(none)'}`,
      );
    }
    return entry;
  }

  listAll(): ReadonlyArray<AngelEntry> {
    return this.entries;
  }

  getRoot(): AngelEntry {
    return this.root;
  }

  getByPath(path: string): AngelEntry {
    const entry = this.byPath.get(path);
    if (entry === undefined) {
      const available = [...this.byPath.keys()].join(', ');
      throw new Error(
        `Angel not found with path "${path}". Registered paths: ${available || '(none)'}`,
      );
    }
    return entry;
  }
}
