import type { ListResult } from 'pocketbase';
import {
  DirectoryMutator,
  MediaMutator,
  directoryNameError,
  type Directory,
  type Media,
  type TypedPocketBase,
} from '@project/shared';

/** A mutator without the default WorkspaceRef expand — the CLI only needs
 * the flat records themselves. */
function directoryMutator(pb: TypedPocketBase): DirectoryMutator {
  return new DirectoryMutator(pb, { expand: [] });
}

/**
 * True when a directory ref means "no directory" — the workspace root.
 * Accepted spellings: `/`, `root`, `none`, and the empty string.
 */
export function isRootDirRef(ref: string): boolean {
  const normalized = ref.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'root' ||
    normalized === 'none' ||
    /^\/+$/.test(normalized)
  );
}

/** Every directory in the workspace (flat, name-sorted, first 500). */
export async function listDirectories(
  pb: TypedPocketBase,
  workspaceId: string
): Promise<ListResult<Directory>> {
  return directoryMutator(pb).getList(
    1,
    500,
    pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId })
  );
}

/**
 * Resolve a directory ref against an already-loaded flat workspace list.
 * A ref may be a record id or a name ("hawaii", "/hawaii"); matching is
 * case-insensitive with a unique-substring fuzzy fallback. Directories are
 * flat, so a nested path like "trips/hawaii" is rejected outright.
 */
export function resolveDirectoryIn(dirs: Directory[], ref: string): Directory {
  const trimmed = ref.trim();
  const byId = dirs.find((d) => d.id === trimmed);
  if (byId) return byId;

  const name = trimmed.replace(/^\/+|\/+$/g, '').trim();
  if (name.includes('/')) {
    throw new Error(
      `Directories are flat — "${ref}" is not a nested path. Use a single name like "${name.split('/').filter(Boolean).pop()}".`
    );
  }

  if (name) {
    const want = name.toLowerCase();
    // The DB unique index guarantees at most one exact match per workspace.
    const exact = dirs.find((d) => d.name.toLowerCase() === want);
    if (exact) return exact;

    const fuzzy = dirs.filter((d) => d.name.toLowerCase().includes(want));
    if (fuzzy.length === 1) return fuzzy[0];
    if (fuzzy.length > 1) {
      const candidates = fuzzy.map((d) => `${d.name} (${d.id})`).join(', ');
      throw new Error(
        `Directory "${ref}" is ambiguous — matches: ${candidates}. Use the exact name or the id.`
      );
    }
  }

  throw new Error(
    `No directory matching "${ref}" — vw dir list shows this workspace's directories (name or id both work)`
  );
}

/**
 * Resolve a directory by record id or name in one call (loads the flat
 * workspace list first).
 */
export async function resolveDirectory(
  pb: TypedPocketBase,
  workspaceId: string,
  ref: string
): Promise<Directory> {
  return resolveDirectoryIn(
    (await listDirectories(pb, workspaceId)).items,
    ref
  );
}

/**
 * Validate a new directory name against the shared path-safe rule (letters,
 * digits, dashes, underscores). Accepts and strips a leading "/" so
 * `vw dir create /hawaii` works; returns the trimmed name.
 */
export function assertValidDirectoryName(raw: string): string {
  const name = raw
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .trim();
  if (name.includes('/')) {
    throw new Error(
      `Directories are flat — "${raw}" is not a nested path. Create a single folder like "${name.split('/').filter(Boolean).pop()}".`
    );
  }
  const error = directoryNameError(name);
  if (error) {
    throw new Error(`Invalid directory name "${raw}" — ${error}.`);
  }
  return name;
}

export interface CreateDirectoryResult {
  directory: Directory;
  /** True when the name already existed and no new record was created. */
  existed: boolean;
}

/**
 * Create a directory by name. Idempotent: an existing directory with the
 * same name (case-insensitive — names are unique per workspace) is returned
 * instead of an error.
 */
export async function createDirectory(
  pb: TypedPocketBase,
  workspaceId: string,
  rawName: string
): Promise<CreateDirectoryResult> {
  const name = assertValidDirectoryName(rawName);
  const existing = (await listDirectories(pb, workspaceId)).items.find(
    (d) => d.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return { directory: existing, existed: true };

  const directory = await directoryMutator(pb).create({
    WorkspaceRef: workspaceId,
    name,
  });
  return { directory, existed: false };
}

export interface RenameDirectoryResult {
  directory: Directory;
  previousName: string;
}

/** Rename a directory (path-safe name, unique per workspace). */
export async function renameDirectory(
  pb: TypedPocketBase,
  workspaceId: string,
  ref: string,
  newName: string
): Promise<RenameDirectoryResult> {
  const name = assertValidDirectoryName(newName);
  const dirs = (await listDirectories(pb, workspaceId)).items;
  const dir = resolveDirectoryIn(dirs, ref);
  const clash = dirs.find(
    (d) => d.id !== dir.id && d.name.toLowerCase() === name.toLowerCase()
  );
  if (clash) {
    throw new Error(
      `A directory named "${clash.name}" already exists (${clash.id}) — names are unique per workspace.`
    );
  }
  const directory = await directoryMutator(pb).rename(dir.id, name);
  return { directory, previousName: dir.name };
}

export interface DeleteDirectoryResult {
  directory: Directory;
  /** Media unfiled back to the workspace root before the delete. */
  unfiledMediaIds: string[];
}

/**
 * Delete a directory. Refuses while media is still filed in it unless
 * `force` is set, in which case the media are unfiled back to the workspace
 * root first. Media are never deleted — a directory is only a label.
 */
export async function deleteDirectory(
  pb: TypedPocketBase,
  workspaceId: string,
  ref: string,
  opts: { force?: boolean } = {}
): Promise<DeleteDirectoryResult> {
  const dirs = (await listDirectories(pb, workspaceId)).items;
  const dir = resolveDirectoryIn(dirs, ref);

  const mediaRows = (await pb.collection('Media').getFullList({
    filter: pb.filter('DirectoryRef = {:id}', { id: dir.id }),
    fields: 'id',
    batch: 500,
  })) as Pick<Media, 'id'>[];

  if (mediaRows.length > 0 && !opts.force) {
    throw new Error(
      `Directory "${dir.name}" still contains ${mediaRows.length} media. --force unfiles them back to the workspace root (media are never deleted).`
    );
  }

  const mediaMutator = new MediaMutator(pb);
  for (const row of mediaRows) {
    await mediaMutator.update(row.id, { DirectoryRef: '' } as Partial<Media>);
  }
  await directoryMutator(pb).delete(dir.id);

  return { directory: dir, unfiledMediaIds: mediaRows.map((m) => m.id) };
}

export interface DirectoryMediaCounts {
  /** Media count per directory id (directories with no media are absent). */
  byDirectory: Map<string, number>;
  /** Media with no directory — sitting at the workspace root. */
  root: number;
  total: number;
}

/** Count the workspace's media per directory (one field-limited query). */
export async function mediaCountsByDirectory(
  pb: TypedPocketBase,
  workspaceId: string
): Promise<DirectoryMediaCounts> {
  const rows = (await pb.collection('Media').getFullList({
    filter: pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId }),
    fields: 'id,DirectoryRef',
    batch: 500,
  })) as Pick<Media, 'id' | 'DirectoryRef'>[];

  const byDirectory = new Map<string, number>();
  let root = 0;
  for (const row of rows) {
    if (row.DirectoryRef) {
      byDirectory.set(
        row.DirectoryRef,
        (byDirectory.get(row.DirectoryRef) ?? 0) + 1
      );
    } else {
      root += 1;
    }
  }
  return { byDirectory, root, total: rows.length };
}
