#!/usr/bin/env node
const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
if (nodeMajor < 22) {
  console.error(`ERROR: Guard Angels requires Node.js >= 22 (found ${process.version})`);
  process.exit(1);
}
const { program } = await import('../cli.js');

program.parse();
