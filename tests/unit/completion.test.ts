import { describe, it, expect } from 'vitest';
import { generateCompletion } from '../../src/commands/completion.js';
import { program } from '../../src/cli.js';

const COMMANDS = [
  { name: 'init', description: 'Bootstrap .angels/ in current project' },
  { name: 'brief', description: 'Phase 1: Write a brief, invoke angel in review mode' },
];

describe('generateCompletion', () => {
  it('generates a bash script registering completion for angels', () => {
    const script = generateCompletion('bash', COMMANDS);
    expect(script).toContain('complete -F _angels_completions angels');
    expect(script).toContain('init');
    expect(script).toContain('brief');
    expect(script).toContain('--version');
  });

  it('generates a zsh script with command descriptions', () => {
    const script = generateCompletion('zsh', COMMANDS);
    expect(script).toContain('#compdef angels');
    expect(script).toContain("'init:Bootstrap .angels/ in current project'");
    // Colons inside descriptions are escaped so _describe parses entries correctly.
    expect(script).toContain("'brief:Phase 1\\: Write a brief, invoke angel in review mode'");
  });

  it('throws on an unsupported shell', () => {
    expect(() => generateCompletion('fish', COMMANDS)).toThrow(
      'Unsupported shell: "fish". Supported shells: bash, zsh.',
    );
  });

  it('covers every command registered on the CLI program', () => {
    const names = program.commands
      .map((cmd) => cmd.name())
      .filter((name) => name !== 'help');
    const script = generateCompletion('bash', names.map((name) => ({ name, description: '' })));
    for (const name of names) {
      expect(script).toContain(name);
    }
    expect(names).toContain('completion');
  });
});
