import type { ListResult } from 'pocketbase';
import {
  DirectoryMutator,
  type Directory,
  type TypedPocketBase,
} from '@project/shared';

/** A mutator without the default WorkspaceRef/ParentDirectoryRef expands —
 * paths are computed from the flat list, so the expands are dead weight. */
function directoryMutator(pb: TypedPocketBase): DirectoryMutator {
  return new DirectoryMutator(pb, { expand: [] });
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
 * Display path ("Hawaii/Maui") for every directory in a flat workspace list,
 * keyed by directory id. A missing parent (or a cycle) just truncates the
 * path at that point rather than failing.
 */
export function directoryPaths(dirs: Directory[]): Map<string, string> {
  const byId = new Map(dirs.map((d) => [d.id, d]));
  const paths = new Map<string, string>();
  for (const dir of dirs) {
    const parts = [dir.name];
    const seen = new Set([dir.id]);
    let parent = dir.ParentDirectoryRef
      ? byId.get(dir.ParentDirectoryRef)
      : undefined;
    while (parent && !seen.has(parent.id)) {
      parts.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.ParentDirectoryRef
        ? byId.get(parent.ParentDirectoryRef)
        : undefined;
    }
    paths.set(dir.id, parts.join('/'));
  }
  return paths;
}

/**
 * Resolve a directory by record id or name: id lookup first, then exact
 * name, then fuzzy match (unambiguous single hit only) — mirrors
 * resolveEntity.
 */
export async function resolveDirectory(
  pb: TypedPocketBase,
  workspaceId: string,
  ref: string
): Promise<Directory> {
  const mutator = directoryMutator(pb);

  const byId = await mutator.getById(ref);
  if (byId && byId.WorkspaceRef === workspaceId) return byId;

  const byName = await mutator.getFirstByFilter(
    pb.filter('WorkspaceRef = {:ws} && name = {:name}', {
      ws: workspaceId,
      name: ref,
    })
  );
  if (byName) return byName;

  const fuzzy = await mutator.getList(
    1,
    5,
    pb.filter('WorkspaceRef = {:ws} && name ~ {:name}', {
      ws: workspaceId,
      name: ref,
    })
  );
  if (fuzzy.items.length === 1) return fuzzy.items[0];
  if (fuzzy.items.length > 1) {
    const candidates = fuzzy.items.map((d) => `${d.name} (${d.id})`).join(', ');
    throw new Error(
      `Directory "${ref}" is ambiguous — matches: ${candidates}. Use the id.`
    );
  }
  throw new Error(
    `No directory matching "${ref}" — vw directory list shows this workspace's directories`
  );
}
