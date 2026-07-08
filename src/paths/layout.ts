import { join } from 'node:path';

const ANGELS_DIR = '.angels';

export function angelsRoot(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR);
}

export function configFile(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_config.yml');
}

export function newspaperFile(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_newspaper.md');
}

export function newspaperGenerationFile(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_newspaper.generation');
}

export function briefsDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_briefs');
}

export function responsesDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_responses');
}

export function inboxDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_inbox');
}

export function outboxDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_outbox');
}

export function locksDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_locks');
}

export function logsDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_logs');
}

export function cursorsDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_cursors');
}

export function archiveDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_archive');
}

export function rootAngelDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_root');
}

export function angelMdFile(projectRoot: string, angelPath: string): string {
  // The root territory ('.') stores its angel.md under the '_root' directory.
  const dir = angelPath === '.' ? '_root' : angelPath;
  return join(projectRoot, ANGELS_DIR, dir, 'angel.md');
}

export function angelBriefsDir(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_briefs', angelId);
}

export function angelResponsesDir(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_responses', angelId);
}

export function angelInboxDir(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_inbox', angelId);
}

export function angelOutboxDir(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_outbox', angelId);
}

export function angelLogsDir(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_logs', angelId);
}

export function angelCursorFile(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_cursors', angelId);
}

export function chatDir(projectRoot: string): string {
  return join(projectRoot, ANGELS_DIR, '_chat');
}

export function angelChatFile(projectRoot: string, angelId: string): string {
  return join(projectRoot, ANGELS_DIR, '_chat', `${angelId}.md`);
}
