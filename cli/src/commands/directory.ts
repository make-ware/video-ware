import type { Command } from 'commander';
import { MediaMutator, type Directory } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId, type MediaWithUpload } from '../lib/select.js';
import {
  createDirectory,
  deleteDirectory,
  listDirectories,
  mediaCountsByDirectory,
  renameDirectory,
  resolveDirectoryIn,
} from '../lib/directory.js';
import { mediaColumns, moveMedia } from '../lib/media.js';
import { withJsonOption } from '../lib/options.js';
import {
  info,
  printList,
  printRecord,
  success,
  type Column,
} from '../lib/output.js';

/** A directory row enriched for display: how many media it holds. */
type DirectoryRow = Directory & { mediaCount: number };

export function registerDirectoryCommands(program: Command): void {
  const directory = program
    .command('directory')
    .alias('dir')
    .description(
      'Optional, flat media folders (e.g. per shoot or location) — purely an organizational filter: media without one sits at the workspace root, media clips follow their parent media’s directory, and names are unique per workspace. Commands accept a name ("hawaii") or an id.'
    );

  withJsonOption(
    directory
      .command('list')
      .alias('ls')
      .description('List directories in the active workspace with media counts')
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const [result, counts] = await Promise.all([
        listDirectories(pb, workspaceId),
        mediaCountsByDirectory(pb, workspaceId),
      ]);
      const rows: DirectoryRow[] = result.items.map((d) => ({
        ...d,
        mediaCount: counts.byDirectory.get(d.id) ?? 0,
      }));

      if (opts.json) {
        printRecord(
          {
            items: rows,
            totalItems: result.totalItems,
            unfiledMedia: counts.root,
            totalMedia: counts.total,
          },
          [],
          true
        );
        return;
      }

      const columns: Column<DirectoryRow>[] = [
        { header: 'ID', value: (d) => d.id },
        { header: 'NAME', value: (d) => d.name },
        { header: 'MEDIA', value: (d) => String(d.mediaCount) },
      ];
      printList(rows, columns, {
        totalItems: result.totalItems,
        hint: 'vw media list -d <dir> filters, vw dir move <dir> <mediaId…> files media',
      });
      info(
        rows.length === 0
          ? `Directories are optional — all ${counts.total} media sit at the workspace root. vw dir create <name> makes one.`
          : `${counts.root} of ${counts.total} media are unfiled (workspace root) — vw media list -d / lists them.`
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    directory
      .command('show <dir>')
      .description('Show one directory (name or id) and the media filed in it')
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (ref: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const dir = resolveDirectoryIn(
        (await listDirectories(pb, workspaceId)).items,
        ref
      );
      const media = await new MediaMutator(pb).getByDirectory(dir.id, 1, 200);
      const items = media.items as MediaWithUpload[];

      if (opts.json) {
        printRecord(
          { ...dir, media: items, totalMedia: media.totalItems },
          [],
          true
        );
        return;
      }

      info(`Directory "${dir.name}" (${dir.id}) — ${media.totalItems} media`);
      printList(items, mediaColumns(items), {
        totalItems: media.totalItems,
        hint: `vw dir move ${dir.name} <mediaId…> files more media here`,
      });
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    directory
      .command('create <name>')
      .description(
        'Create a directory — flat, unique per workspace; names allow letters, digits, dashes, and underscores (idempotent)'
      )
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (name: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await createDirectory(pb, workspaceId, name);
      if (opts.json) {
        printRecord({ ...result.directory, existed: result.existed }, [], true);
        return;
      }
      if (result.existed) {
        info(
          `Directory "${result.directory.name}" already exists (${result.directory.id})`
        );
      } else {
        success(
          `Created directory "${result.directory.name}" (${result.directory.id})`
        );
      }
      info(
        `  vw dir move ${result.directory.name} <mediaId…> files media into it`
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    directory
      .command('rename <dir> <newName>')
      .description(
        'Rename a directory (name or id; new name must be path-safe and unique)'
      )
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (ref: string, newName: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await renameDirectory(pb, workspaceId, ref, newName);
      if (opts.json) {
        printRecord(result.directory, [], true);
        return;
      }
      success(
        `Renamed directory "${result.previousName}" → "${result.directory.name}" (${result.directory.id})`
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    directory
      .command('move <dir> <mediaIds...>')
      .alias('mv')
      .description(
        'Move media into a directory (name or id) — "/" or "none" re-files them at the workspace root'
      )
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (ref: string, mediaIds: string[], opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await moveMedia(pb, workspaceId, ref, mediaIds);
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      const target = result.directory
        ? `directory "${result.directory.name}" (${result.directory.id})`
        : 'the workspace root';
      success(`Moved ${result.moved.length} media into ${target}`);
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    directory
      .command('delete <dir>')
      .alias('rm')
      .description(
        'Delete a directory (name or id). Refuses while media is filed in it; --force unfiles the media first — media are never deleted'
      )
      .option('-w, --workspace <id>', 'workspace id override')
      .option(
        '-f, --force',
        'unfile any contained media back to the workspace root, then delete'
      )
  ).action(async (ref: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await deleteDirectory(pb, workspaceId, ref, {
        force: opts.force,
      });
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      success(
        `Deleted directory "${result.directory.name}" (${result.directory.id})`
      );
      if (result.unfiledMediaIds.length > 0) {
        info(
          `  ${result.unfiledMediaIds.length} media unfiled back to the workspace root`
        );
      }
    } catch (err) {
      handleError(err);
    }
  });
}
