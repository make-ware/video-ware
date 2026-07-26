/**
 * Register a spec's flags on a commander command.
 *
 * One call replaces the per-command pile of `-w`, `--json`, and filter
 * `.option()` lines, so a list command's registration is exactly its spec.
 * Flag *names* therefore can't drift from what the runner reads back out of
 * the options bag: a spec key that doesn't match the attribute name commander
 * derives from its flags throws at startup, the same guard `applyOptions`
 * uses.
 */
import { InvalidArgumentError, Option, type Command } from 'commander';
import { listResultHelp } from '../help.js';
import { DEFAULT_LIST_LIMIT, filtersOf, type ListSpec } from './spec.js';
import { sortNamesOf } from './query.js';

export interface ListOptionsConfig {
  /**
   * Fan-out list: also register `--max-depth`, the per-collection over-fetch
   * bound that decides how deep merged pages can go.
   */
  merged?: boolean;
}

/** Parse a positive integer flag value (`--limit`, `--page`, `--max-depth`). */
export function parseCount(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError('expected a positive integer');
  }
  return n;
}

/**
 * Register every declared filter, the paging/sorting flags, `--json`, and the
 * shared list help epilogue. Returns the command for chaining.
 *
 * `-w` is deliberately absent: `lib/workspace-option.ts` walks the finished
 * command tree and registers it everywhere, so declaring it here would fork
 * the flag's description away from the one every other command shows.
 */
export function withListOptions<T, TRow>(
  cmd: Command,
  spec: ListSpec<T, TRow>,
  config: ListOptionsConfig = {}
): Command {
  for (const [key, filter] of Object.entries(filtersOf(spec))) {
    const option = new Option(filter.flags, filter.description);
    if (option.attributeName() !== key) {
      throw new Error(
        `${spec.command}: filter key "${key}" must match the flag attribute ` +
          `name "${option.attributeName()}" (${filter.flags})`
      );
    }
    if (filter.parse) {
      option.argParser(filter.parse as (value: string) => unknown);
    }
    cmd.addOption(option);
  }

  const limitDefault = spec.unpaged
    ? 'default: every row'
    : `default: ${spec.defaultLimit ?? DEFAULT_LIST_LIMIT}`;
  cmd.option(
    '-n, --limit <count>',
    `rows per page (${limitDefault})`,
    parseCount
  );
  cmd.option('--page <n>', 'page to show (default: 1)', parseCount);

  if (spec.sorts && spec.sorts.length > 0) {
    const names = sortNamesOf(spec);
    cmd.option(
      '--sort <field>',
      `order results (${names.join(', ')}; default: ${names[0]})`
    );
  }

  cmd.option('--all', 'fetch every page instead of one');
  cmd.option('--json', 'print full records as JSON (machine-readable)');

  if (config.merged) {
    cmd.option(
      '--max-depth <rows>',
      'rows read per collection when merging paged results (default: 500)',
      parseCount
    );
  }

  cmd.addHelpText('after', listResultHelp(spec, config));
  return cmd;
}
