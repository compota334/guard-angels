import * as fs from 'node:fs';
import { loadConfig } from '../config/load.js';
import { AngelRegistry } from '../angels/registry.js';
import { chatDir, angelChatFile } from '../paths/layout.js';

export function chatWithAngel(cwd: string, angelId: string, message: string): void {
  const config = loadConfig(cwd);
  const registry = AngelRegistry.fromConfig(config);
  registry.getById(angelId); // throws if not found

  fs.mkdirSync(chatDir(cwd), { recursive: true });

  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(angelChatFile(cwd, angelId), line);

  console.log(`Note appended to chat history for ${angelId}.`);
}
