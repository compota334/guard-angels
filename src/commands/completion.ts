export interface CompletionCommand {
  name: string;
  description: string;
}

const SUPPORTED_SHELLS = ['bash', 'zsh'] as const;
export type CompletionShell = (typeof SUPPORTED_SHELLS)[number];

function isSupportedShell(shell: string): shell is CompletionShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(shell);
}

/** Escape a zsh _describe entry: backslashes, quotes and separator colons. */
function zshEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

function bashScript(commands: CompletionCommand[]): string {
  const names = commands.map((c) => c.name).join(' ');
  return `# bash completion for angels
# Install: angels completion bash >> ~/.bashrc
# or:      angels completion bash > /etc/bash_completion.d/angels
_angels_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names} --help --version --verbose" -- "$cur") )
  fi
}
complete -F _angels_completions angels
`;
}

function zshScript(commands: CompletionCommand[]): string {
  const entries = commands
    .map((c) => `    '${zshEscape(c.name)}:${zshEscape(c.description)}'`)
    .join('\n');
  return `#compdef angels
# zsh completion for angels
# Install: angels completion zsh > "\${fpath[1]}/_angels"
# or eval directly: eval "$(angels completion zsh)"
_angels() {
  local -a commands
  commands=(
${entries}
  )
  if (( CURRENT == 2 )); then
    _describe -t commands 'angels command' commands
  fi
}
if [ "$funcstack[1]" = "_angels" ]; then
  _angels "$@"
else
  compdef _angels angels
fi
`;
}

/**
 * Generate a shell completion script for the given shell.
 *
 * Command names and descriptions are passed in by the CLI layer so the
 * script always reflects the currently registered commands.
 */
export function generateCompletion(
  shell: string,
  commands: CompletionCommand[],
): string {
  if (!isSupportedShell(shell)) {
    throw new Error(
      `Unsupported shell: "${shell}". Supported shells: ${SUPPORTED_SHELLS.join(', ')}.`,
    );
  }
  return shell === 'bash' ? bashScript(commands) : zshScript(commands);
}
