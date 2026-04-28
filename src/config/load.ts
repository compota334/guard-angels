import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { ConfigSchema, type Config } from './schema.js';

export function loadConfig(cwd: string): Config {
  const configPath = path.join(cwd, '.angels', '_config.yml');

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `Config file not found: ${configPath}\nRun "angels init" to bootstrap .angels/ in your project.`,
        { cause: err },
      );
    }
    throw new Error(
      `Failed to read config file ${configPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err: unknown) {
    throw new Error(
      `Invalid YAML in ${configPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  try {
    return ConfigSchema.parse(parsed);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const details = err.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(
        `Invalid config in ${configPath}:\n${details}`,
        { cause: err },
      );
    }
    throw err;
  }
}
