import type { Command } from 'commander';
import { MediaMutator, type TypedPocketBase } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId, type MediaWithUpload } from '../lib/select.js';
import {
  createDirectory,
  deleteDirectory,
  fetchDirectoryPage,
  listDirectories,
  makeDirectoryListSpec,
  mediaCountsByDirectory,
  renameDirectory,
  resolveDirectoryIn,
  type DirectoryMediaCounts,
} from '../lib/directory.js';
import { mediaColumns, moveMedia } from '../lib/media.js';
import { withJsonOption } from '../lib/options.js';
import { info, printList, printRecord, success } from '../lib/output.js';
import { runList, withListOptions } from '../lib/list/index.js';
import { DIRECTORY_HELP } from '../lib/help.js';

export function registerDirectoryCommands(program: Command): void {
  const directory = program
    .command('directory')
    .alias('dir')
    .description(
      'Optional flat folders that group media by shoot, location, or client'
    )
    .addHelpText('after', DIRECTORY_HELP);

  // The counts query is a full media scan of the workspace, needed three
  // times per `directory list` (MEDIA column, unfiled-media summary, --json
  // envelope). Memoized so one invocation scans exactly once — a CLI process
  // runs a single command, so the memo cannot go stale.
  let countsPromise: Promise<DirectoryMediaCounts> | undefined;
  const countsOnce = (
    pb: TypedPocketBase,
    workspaceId: string
  ): Promise<DirectoryMediaCounts> =>
    (countsPromise ??= mediaCountsByDirectory(pb, workspaceId));
  const directoryListSpec = makeDirectoryListSpec(countsOnce);

  withListOptions(
    directory
      .command('list')
      .alias('ls')
      .description('List directories with their media counts'),
    directoryListSpec
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      await runList({
        spec: directoryListSpec,
        opts,
        ctx: { pb, workspaceId },
        fetchPage: (query) => fetchDirectoryPage(pb, query),
        // Workspace-wide counts scripts have always read from this envelope —
        // kept top-level alongside the pagination keys.
        jsonExtras: async () => {
          const counts = await countsOnce(pb, workspaceId);
          return { unfiledMedia: counts.root, totalMedia: counts.total };
        },
      });
      // The unfiled-media tally is about the workspace, not this page, so it
      // sits after the list rather than in its footer.
      if (!opts.json) {
        const counts = await countsOnce(pb, workspaceId);
        info(
          counts.byDirectory.size === 0
            ? `Directories are optional — all ${counts.total} media sit at the workspace root. vw dir create <name> makes one.`
            : `${counts.root} of ${counts.total} media are unfiled (workspace root) — vw media list -d / lists them.`
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    directory
      .command('show <dir>')
      .description('Show one directory and the media filed in it')
  ).action(async (ref: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
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
        'Create a directory — idempotent; letters, digits, dashes, underscores'
      )
  ).action(async (name: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
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
      .description('Rename a directory — the new name must be free')
  ).action(async (ref: string, newName: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
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
      .description('File media into a directory — "/" unfiles them')
  ).action(async (ref: string, mediaIds: string[], opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
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
        'Delete a directory — refuses if media is filed in it (media is never deleted)'
      )
      .option(
        '-f, --force',
        'unfile any contained media back to the workspace root, then delete'
      )
  ).action(async (ref: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
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
