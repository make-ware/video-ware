import type { Command } from 'commander';
import { WorkspaceMutator, type TypedPocketBase } from '@project/shared';
import { loadConfig } from './config.js';

/**
 * `-w/--workspace` — the uniform per-invocation workspace override.
 *
 * `installWorkspaceOption` registers the flag on **every** command in the tree
 * (walked at startup, so new commands get it for free) and installs a
 * `preAction` hook that captures whatever `-w` was passed, wherever it appeared
 * on the command line. Uniform acceptance is the point: an agent that always
 * passes `-w <id>` never has to know which commands are workspace-scoped and
 * never eats an "unknown option" error for a flag that happens to be redundant.
 *
 * Precedence, most specific first: the leaf command's `-w` → an ancestor's `-w`
 * (`vw -w ID media list` and `vw media -w ID list` both work) → the workspace
 * persisted by `vw workspace use` → the interactive picker.
 *
 * The override lives for one invocation and is never written to the config file;
 * `vw workspace use` stays the only way to change the active workspace. Commands
 * that address a record by id don't need it (record ids are globally unique),
 * but where the record's workspace is known they validate it — passing a `-w`
 * that contradicts the record is a mistake worth reporting, not worth ignoring.
 *
 * Contributors: don't declare `-w` on individual commands. The walk covers
 * them, and `src/__tests__/workspace-option.test.ts` fails if a command is
 * registered after the walk runs.
 */

const WORKSPACE_FLAGS = '-w, --workspace <id>';
const WORKSPACE_DESCRIPTION =
  'workspace id, slug, or name — overrides the active workspace for this command only';

/** Refs safe to interpolate into a PocketBase filter (slug lookup). */
const SIMPLE_REF = /^[A-Za-z0-9_-]+$/;

/** The raw `-w` value for this invocation (an id, slug, or name). */
let override: string | undefined;
/** Memoized ref → id resolution, so one invocation looks it up at most once. */
let resolved: { ref: string; id: string } | undefined;

/** Set the override directly (the `preAction` hook and tests). */
export function setWorkspaceOverride(ref: string | undefined): void {
  override = ref;
  resolved = undefined;
}

/** The raw `-w` value passed to this invocation, if any. */
export function workspaceOverride(): string | undefined {
  return override;
}

/** The `-w` value from the leaf command up — the most specific one wins. */
function nearestWorkspaceOption(cmd: Command): string | undefined {
  for (let current: Command | null = cmd; current; current = current.parent) {
    const value = (current.opts() as { workspace?: unknown }).workspace;
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/** Add `-w` to a command and every subcommand that doesn't declare it. */
function addWorkspaceOption(cmd: Command): void {
  const declared = cmd.options.some(
    (opt) => opt.short === '-w' || opt.long === '--workspace'
  );
  if (!declared) {
    cmd.option(WORKSPACE_FLAGS, WORKSPACE_DESCRIPTION);
  }
  for (const sub of cmd.commands) {
    addWorkspaceOption(sub);
  }
}

/**
 * Register `-w` across the whole command tree and start capturing it. Call once,
 * after every command is registered (see `buildProgram`).
 */
export function installWorkspaceOption(program: Command): Command {
  addWorkspaceOption(program);
  program.hook('preAction', (_program, actionCommand) => {
    setWorkspaceOverride(nearestWorkspaceOption(actionCommand));
  });
  return program;
}

/**
 * Resolve a workspace ref (id, slug, or name — the CLI accepts all three, like
 * directory and entity refs) to an id. Passing the already-active workspace —
 * what an agent does on every command — costs no request.
 */
export async function resolveWorkspaceRef(
  pb: TypedPocketBase,
  ref: string
): Promise<string> {
  if (ref === loadConfig().workspaceId) return ref;
  if (resolved?.ref === ref) return resolved.id;

  const mutator = new WorkspaceMutator(pb);
  const found =
    (await mutator.getById(ref)) ?? (await findBySlugOrName(mutator, ref));
  if (!found) {
    throw new Error(
      `No workspace matching "${ref}" — vw workspace list shows the ids you can pass.`
    );
  }
  resolved = { ref, id: found.id };
  return found.id;
}

async function findBySlugOrName(mutator: WorkspaceMutator, ref: string) {
  const bySlug = SIMPLE_REF.test(ref) ? await mutator.getBySlug(ref) : null;
  if (bySlug) return bySlug;
  const lower = ref.toLowerCase();
  const all = await mutator.getList(1, 200);
  return all.items.find((ws) => ws.name.toLowerCase() === lower) ?? null;
}

/**
 * Refuse a `-w` that contradicts the record the command is acting on. No-ops
 * when no `-w` was passed, so id-addressed commands stay single-request.
 */
export async function assertWorkspaceMatch(
  pb: TypedPocketBase,
  workspaceRef: string,
  subject: string
): Promise<void> {
  if (!override || !workspaceRef) return;
  const wanted = await resolveWorkspaceRef(pb, override);
  if (wanted === workspaceRef) return;
  throw new Error(
    `${subject} belongs to workspace ${workspaceRef}, not ${wanted} (-w). ` +
      `Record ids are globally unique — drop -w, or pass -w ${workspaceRef}.`
  );
}
