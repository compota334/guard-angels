import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ExistingMemory {
  /** Which file was found, or null if none */
  source: 'AGENTS.md' | 'CLAUDE.md' | null;
  /** File contents, or null if no memory file found */
  content: string | null;
}

/**
 * Check whether a folder has existing memory files (AGENTS.md or CLAUDE.md)
 * that can be used to seed an angel.md draft.
 *
 * Rules:
 * - AGENTS.md is always checked first (preferred source).
 * - CLAUDE.md is checked only for non-root folders. The project-root
 *   CLAUDE.md is the user's main-agent instructions, not a per-folder
 *   memory file.
 * - If both exist, AGENTS.md wins.
 * - Returns null source/content if neither is found.
 */
export async function detectExistingMemory(
  folderPath: string,
  projectRoot: string,
): Promise<ExistingMemory> {
  const resolvedFolder = resolve(folderPath);
  const resolvedRoot = resolve(projectRoot);

  // Check AGENTS.md first
  const agentsPath = join(resolvedFolder, 'AGENTS.md');
  const agentsContent = await tryReadFile(agentsPath);
  if (agentsContent !== null) {
    return { source: 'AGENTS.md', content: agentsContent };
  }

  // Check CLAUDE.md only for non-root folders
  const isRoot = resolvedFolder === resolvedRoot;
  if (!isRoot) {
    const claudePath = join(resolvedFolder, 'CLAUDE.md');
    const claudeContent = await tryReadFile(claudePath);
    if (claudeContent !== null) {
      return { source: 'CLAUDE.md', content: claudeContent };
    }
  }

  return { source: null, content: null };
}

const MAX_MEMORY_CHARS = 102400; // 100 KB

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
    const content = await readFile(filePath, 'utf-8');
    if (content.length > MAX_MEMORY_CHARS) {
      return (
        content.slice(0, MAX_MEMORY_CHARS) +
        '\n... (truncated: file exceeds 100 KB limit)'
      );
    }
    return content;
  } catch {
    return null;
  }
}
