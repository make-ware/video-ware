import { InvalidArgumentError, Option, type Command } from 'commander';

/**
 * Declarative commander option groups.
 *
 * A group maps option keys 1:1 onto fields of a lib-level options object:
 * `applyOptions` registers the flags on a command and `pickOptions` extracts
 * the parsed values under the same keys, so exposing a new record field is a
 * single new spec in the group. Tie a group to its options interface with
 * `satisfies OptionGroupOf<TheOptions>` so keys and value types are checked
 * at compile time, e.g.:
 *
 *   const clipFieldOptions = {
 *     label: { flags: '--label <text>', description: '...' },
 *     start: { flags: '-s, --start <seconds>', description: '...', parse: parseFloat },
 *   } satisfies OptionGroupOf<CreateMediaClipOptions>;
 *
 *   applyOptions(cmd, clipFieldOptions).action(async (opts) => {
 *     await createMediaClip(pb, { mediaId, ...pickOptions(opts, clipFieldOptions) });
 *   });
 *
 * Specs describe value-taking options; plain boolean flags (`--no-wait`)
 * don't need a group — register them with `cmd.option()` directly.
 */
export interface OptionSpec<T = string> {
  /** commander flags, e.g. '--label <text>' or '-s, --start <seconds>' */
  flags: string;
  description: string;
  /** Parse/validate the raw string; the value stays a string when omitted. */
  parse?: (value: string) => T;
}

export type OptionGroup = Record<string, OptionSpec<unknown>>;

/**
 * Constrains a group to a lib-level options interface: every key must be a
 * field of `T` and every parsed value must match that field's type.
 */
export type OptionGroupOf<T> = {
  [K in keyof T]?: OptionSpec<NonNullable<T[K]>>;
};

type OptionValue<S extends OptionSpec<unknown>> = S extends {
  parse: (value: string) => infer T;
}
  ? T
  : string;

/** Parsed values for a group; every option is optional on the command line. */
export type OptionValues<G extends OptionGroup> = {
  [K in keyof G]?: OptionValue<G[K]>;
};

/**
 * Register every option in the group on the command. Throws at registration
 * time (CLI startup) if a group key doesn't match the attribute name commander
 * derives from its flags — the invariant `pickOptions` relies on.
 */
export function applyOptions<G extends OptionGroup>(
  cmd: Command,
  group: G
): Command {
  for (const [key, spec] of Object.entries(group)) {
    const option = new Option(spec.flags, spec.description);
    if (option.attributeName() !== key) {
      throw new Error(
        `Option group key "${key}" must match the flag attribute name "${option.attributeName()}" (${spec.flags})`
      );
    }
    if (spec.parse) {
      option.argParser(spec.parse);
    }
    cmd.addOption(option);
  }
  return cmd;
}

/** Register the uniform `--json` flag (used by every list/search command). */
export function withJsonOption(cmd: Command): Command {
  return cmd.option('--json', 'print full records as JSON (machine-readable)');
}

/** Parse a non-negative number of seconds; rejects NaN and negatives. */
export function parseSeconds(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new InvalidArgumentError('expected a non-negative number of seconds');
  }
  return n;
}

/** Parse a 0..1 float (volume/opacity/gain); rejects values outside range. */
export function parseUnitInterval(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new InvalidArgumentError('expected a number between 0 and 1');
  }
  return n;
}

/** Extract the group's parsed values (only those actually passed) from opts. */
export function pickOptions<G extends OptionGroup>(
  opts: Record<string, unknown>,
  group: G
): OptionValues<G> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(group)) {
    if (opts[key] !== undefined) {
      picked[key] = opts[key];
    }
  }
  return picked as OptionValues<G>;
}
