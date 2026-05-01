import * as fs from "fs";
import * as path from "path";

export interface DiscoveryEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: DiscoveryEntry[];
}

export interface DiscoveryResult {
  root: string;
  entries: DiscoveryEntry[];
  fileCount: number;
  dirCount: number;
}

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  ".env",
  "dist",
  "build",
  ".cache",
]);

export function discoverTerritory(
  rootPath: string,
  ignore: Set<string> = DEFAULT_IGNORE,
  maxDepth = 10,
  currentDepth = 0
): DiscoveryEntry[] {
  if (currentDepth >= maxDepth) return [];

  type RawEntry = { name: string; fullPath: string; isDir: boolean; size: number };
  let raw: RawEntry[];
  try {
    raw = fs.readdirSync(rootPath).map((name) => {
      const fullPath = path.join(rootPath, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, isDir: stat.isDirectory(), size: stat.size };
    });
  } catch {
    return [];
  }

  const entries = raw;
  const result: DiscoveryEntry[] = [];

  for (const { name, fullPath, isDir, size } of entries) {
    if (ignore.has(name)) continue;

    if (isDir) {
      const children = discoverTerritory(fullPath, ignore, maxDepth, currentDepth + 1);
      result.push({ path: fullPath, type: "directory", children });
    } else {
      result.push({ path: fullPath, type: "file", size });
    }
  }

  return result;
}

function countEntries(entries: DiscoveryEntry[]): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;
  for (const entry of entries) {
    if (entry.type === "file") {
      files++;
    } else {
      dirs++;
      if (entry.children) {
        const sub = countEntries(entry.children);
        files += sub.files;
        dirs += sub.dirs;
      }
    }
  }
  return { files, dirs };
}

export function runDiscovery(
  rootPath: string,
  options: { ignore?: Set<string>; maxDepth?: number } = {}
): DiscoveryResult {
  const resolvedRoot = path.resolve(rootPath);
  const entries = discoverTerritory(
    resolvedRoot,
    options.ignore ?? DEFAULT_IGNORE,
    options.maxDepth ?? 10
  );
  const { files, dirs } = countEntries(entries);
  return { root: resolvedRoot, entries, fileCount: files, dirCount: dirs };
}

export function formatDiscovery(result: DiscoveryResult, indent = 0): string {
  const lines: string[] = [];
  if (indent === 0) {
    lines.push(`Territory: ${result.root}`);
    lines.push(`Files: ${result.fileCount}  Directories: ${result.dirCount}`);
    lines.push("");
  }
  for (const entry of result.entries) {
    const prefix = "  ".repeat(indent);
    const label = entry.type === "directory" ? "[D]" : "[F]";
    const name = path.basename(entry.path);
    lines.push(`${prefix}${label} ${name}`);
    if (entry.children) {
      const sub = formatDiscovery(
        { root: entry.path, entries: entry.children, fileCount: 0, dirCount: 0 },
        indent + 1
      );
      lines.push(sub);
    }
  }
  return lines.join("\n");
}
