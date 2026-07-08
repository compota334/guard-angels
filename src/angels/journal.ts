import * as fs from 'node:fs';
import { join } from 'node:path';
import { readAngelMd, writeAngelMd } from './memory.js';
import { angelMdFile, archiveDir } from '../paths/layout.js';

/**
 * Deterministic journal: a `## Journal` section in angel.md that the CLI
 * appends facts to (execute outcomes, human notes) WITHOUT invoking any AI.
 * Facts stay fresh at zero token cost; the angel folds them into the curated
 * sections during sweep and removes the folded bullets.
 *
 * Frontmatter is intentionally left untouched: `last_updated` keeps meaning
 * "last curated memory update", not "last mechanical fact append".
 */

const JOURNAL_HEADER = '## Journal';
const JOURNAL_HINT =
  '<!-- Facts appended mechanically by the CLI. During sweep: fold what matters into the curated sections above, then delete the folded bullets. -->';

/** Bullets beyond this cap rotate (oldest first) to _archive/journal/. */
export const MAX_JOURNAL_ENTRIES = 200;

const BULLET_RE = /^- \[/;

/**
 * Append journal entries to an angel's angel.md, creating the `## Journal`
 * section if needed. Throws if the angel.md does not exist (journaling to a
 * non-existent angel is a bug, not a case to paper over).
 *
 * @param angelPath - Filesystem path of the angel dir under .angels/
 *                    (use angelIdToPath(angelId), NOT the territory path).
 */
export function appendJournal(
  projectRoot: string,
  angelId: string,
  angelPath: string,
  entries: string[],
): void {
  if (entries.length === 0) return;

  const mdPath = angelMdFile(projectRoot, angelPath);
  const md = readAngelMd(mdPath);

  const timestamp = new Date().toISOString();
  const newBullets = entries.map((entry) => `- [${timestamp}] ${entry.replace(/\n/g, ' ')}`);

  const { before, sectionExtras, bullets, after } = splitJournal(md.body);
  let allBullets = [...bullets, ...newBullets];

  // Cap: rotate the oldest overflow into _archive/journal/<angel-id>.md so
  // the memory file cannot grow without bound.
  if (allBullets.length > MAX_JOURNAL_ENTRIES) {
    const overflow = allBullets.slice(0, allBullets.length - MAX_JOURNAL_ENTRIES);
    allBullets = allBullets.slice(allBullets.length - MAX_JOURNAL_ENTRIES);

    const archiveJournalDir = join(archiveDir(projectRoot), 'journal');
    fs.mkdirSync(archiveJournalDir, { recursive: true });
    fs.appendFileSync(
      join(archiveJournalDir, `${angelId}.md`),
      overflow.join('\n') + '\n',
      'utf-8',
    );
  }

  const section = [
    JOURNAL_HEADER,
    '',
    JOURNAL_HINT,
    ...(sectionExtras.length > 0 ? sectionExtras : []),
    '',
    ...allBullets,
  ].join('\n');

  const body =
    before.trimEnd() + '\n\n' + section + '\n' + (after ? '\n' + after : '');

  writeAngelMd(mdPath, { frontmatter: md.frontmatter, body });
}

interface JournalSplit {
  /** Body content before the Journal section. */
  before: string;
  /** Non-bullet, non-hint lines the section contained (preserved). */
  sectionExtras: string[];
  /** Existing journal bullets, oldest first. */
  bullets: string[];
  /** Body content after the Journal section (a later `## ` heading onward). */
  after: string;
}

function splitJournal(body: string): JournalSplit {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim() === JOURNAL_HEADER);
  if (start === -1) {
    return { before: body, sectionExtras: [], bullets: [], after: '' };
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }

  const sectionLines = lines.slice(start + 1, end);
  const bullets = sectionLines.filter((line) => BULLET_RE.test(line));
  const sectionExtras = sectionLines.filter(
    (line) => !BULLET_RE.test(line) && line.trim() !== '' && line.trim() !== JOURNAL_HINT,
  );

  return {
    before: lines.slice(0, start).join('\n'),
    sectionExtras,
    bullets,
    after: lines.slice(end).join('\n').trim(),
  };
}
