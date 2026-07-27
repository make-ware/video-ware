import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '../program.js';

/** `vw --help` as printed, including the addHelpText epilogues. */
function rootHelp(): string {
  const program = buildProgram();
  let out = '';
  program.configureOutput({ writeOut: (str) => (out += str) });
  program.outputHelp();
  return out;
}

/** The command at a path, e.g. ["media", "list"]. */
function commandAt(program: Command, path: string[]): Command {
  return path.reduce((cmd: Command, name) => {
    const found = cmd.commands.find(
      (sub) => sub.name() === name || sub.aliases().includes(name)
    );
    if (!found) throw new Error(`no command "${path.join(' ')}"`);
    return found;
  }, program);
}

describe('vw --help list hint', () => {
  it('tells you lists carry their own context and how to read them by machine', () => {
    const help = rootHelp();
    expect(help).toContain('Lists:');
    expect(help).toContain('footer');
    expect(help).toContain('--json');
    expect(help).toContain('--all');
  });

  // The hint names flags by hand; a rename elsewhere must not leave it lying.
  it('only advertises flags a real list command accepts', () => {
    const list = commandAt(buildProgram(), ['media', 'list']);
    const flags = list.options.flatMap((opt) => [opt.short, opt.long]);
    for (const flag of ['--json', '--all', '-n', '--limit']) {
      expect(flags).toContain(flag);
    }
  });
});
