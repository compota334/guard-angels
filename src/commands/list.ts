import * as fs from 'node:fs';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { angelMdFile } from '../paths/layout.js';

function parseFrontmatterStatus(filePath: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (!raw.startsWith('---\n')) {
    return null;
  }

  const endIdx = raw.indexOf('\n---', 4);
  if (endIdx === -1) {
    return null;
  }

  const frontmatterBlock = raw.slice(4, endIdx);
  for (const line of frontmatterBlock.split('\n')) {
    const match = line.match(/^status:\s*(.+)$/);
    if (match) {
      return match[1]!.trim();
    }
  }

  return null;
}

export function listAngels(cwd: string): void {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  const angels = registry.listAll();

  const rows: Array<{ id: string; type: string; path: string; status: string }> = [];

  for (const angel of angels) {
    const angelPath = angel.type === 'root' ? '_root' : angel.path;
    const mdPath = angelMdFile(cwd, angelPath);
    const status = parseFrontmatterStatus(mdPath) ?? '-';
    rows.push({ id: angel.id, type: angel.type, path: angel.path, status });
  }

  // Compute column widths
  const headers = { id: 'ID', type: 'TYPE', path: 'PATH', status: 'STATUS' };
  const widths = {
    id: Math.max(headers.id.length, ...rows.map((r) => r.id.length)),
    type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
    path: Math.max(headers.path.length, ...rows.map((r) => r.path.length)),
    status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
  };

  const formatRow = (id: string, type: string, path: string, status: string): string =>
    `${id.padEnd(widths.id)}  ${type.padEnd(widths.type)}  ${path.padEnd(widths.path)}  ${status.padEnd(widths.status)}`;

  console.log(formatRow(headers.id, headers.type, headers.path, headers.status));
  console.log(
    formatRow(
      '─'.repeat(widths.id),
      '─'.repeat(widths.type),
      '─'.repeat(widths.path),
      '─'.repeat(widths.status),
    ),
  );

  for (const row of rows) {
    console.log(formatRow(row.id, row.type, row.path, row.status));
  }
}
