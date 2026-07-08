import type { Command } from 'commander';
import { MediaClipMutator, MediaMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import {
  mediaLabel,
  pickMedia,
  resolveWorkspaceId,
  type MediaWithUpload,
} from '../lib/select.js';
import {
  clipFieldOptions,
  createMediaClip,
  deleteMediaClip,
  mediaClipMediaLabel,
  mediaClipUpdateOptions,
  mediaFieldOptions,
  parseClipType,
  searchMedia,
  updateMedia,
  updateMediaClip,
  type MediaClipWithMedia,
} from '../lib/media.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  formatDuration,
  info,
  printList,
  printRecord,
  success,
} from '../lib/output.js';

/** Shared column layout for `media list` and `media search`. */
const mediaColumns = [
  { header: 'ID', value: (m: MediaWithUpload) => m.id },
  { header: 'NAME', value: (m: MediaWithUpload) => mediaLabel(m) },
  { header: 'LABEL', value: (m: MediaWithUpload) => m.label ?? '' },
  { header: 'TYPE', value: (m: MediaWithUpload) => String(m.mediaType) },
  {
    header: 'DURATION',
    value: (m: MediaWithUpload) => formatDuration(m.duration),
  },
  { header: 'SIZE', value: (m: MediaWithUpload) => `${m.width}x${m.height}` },
];

export function registerMediaCommands(program: Command): void {
  const media = program.command('media').description('Browse workspace media');

  withJsonOption(
    media
      .command('list')
      .alias('ls')
      .description('List media in the active workspace')
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await new MediaMutator(pb).getByWorkspace(
        workspaceId,
        1,
        200
      );
      printList(result.items as MediaWithUpload[], mediaColumns, {
        json: opts.json,
        totalItems: result.totalItems,
      });
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    media
      .command('search <query>')
      .alias('find')
      .description('Search workspace media by filename, label, or description')
      .option('-w, --workspace <id>', 'workspace id override')
      .option('-n, --limit <count>', 'max results (default: 50)', (v) =>
        parseInt(v, 10)
      )
  ).action(async (query: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await searchMedia(
        pb,
        workspaceId,
        query,
        opts.limit ?? 50
      );
      printList(result.items as MediaWithUpload[], mediaColumns, {
        json: opts.json,
        totalItems: result.totalItems,
      });
    } catch (err) {
      handleError(err);
    }
  });

  const mediaUpdate = media
    .command('update <mediaId>')
    .alias('set')
    .description('Set a media item’s editor-facing label and description');

  applyOptions(withJsonOption(mediaUpdate), mediaFieldOptions).action(
    async (mediaId: string, opts) => {
      try {
        const pb = await requireClient();
        const updated = await updateMedia(
          pb,
          mediaId,
          pickOptions(opts, mediaFieldOptions)
        );
        if (opts.json) {
          printRecord(updated, [], true);
          return;
        }
        const label = updated.label ? ` "${updated.label}"` : '';
        success(`Updated media ${updated.id}${label}`);
      } catch (err) {
        handleError(err);
      }
    }
  );

  const clip = media
    .command('clip')
    .description(
      'Create and browse media clips (reusable sub-ranges of media)'
    );

  const clipCreate = clip
    .command('create')
    .description('Create a media clip from a media sub-range')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'source media id');

  applyOptions(clipCreate, clipFieldOptions).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);

      let mediaId = opts.media as string | undefined;
      if (!mediaId) {
        mediaId = (await pickMedia(pb, workspaceId)).id;
      }

      const created = await createMediaClip(pb, {
        workspaceId,
        mediaId,
        ...pickOptions(opts, clipFieldOptions),
      });
      const label = created.label ? ` "${created.label}"` : '';
      success(
        `Created ${created.type} clip ${created.id}${label} (${created.start}s–${created.end}s, ${formatDuration(created.duration)}) from media ${mediaId}`
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    clip
      .command('list')
      .alias('ls')
      .description('List media clips in the active workspace')
      .option('-w, --workspace <id>', 'workspace id override')
      .option('-m, --media <id>', 'filter to a single source media')
      .option('--type <type>', 'filter by clip type')
      .option(
        '--search <query>',
        'filter by clip label, description, type, or media filename'
      )
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const mutator = new MediaClipMutator(pb);

      const result = opts.media
        ? await mutator.getByMedia(opts.media, 1, 200)
        : await mutator.getByWorkspace(workspaceId, 1, 200, {
            type: opts.type ? parseClipType(opts.type) : undefined,
            searchQuery: opts.search,
          });

      printList(
        result.items as MediaClipWithMedia[],
        [
          { header: 'ID', value: (c) => c.id },
          { header: 'LABEL', value: (c) => c.label ?? '' },
          { header: 'MEDIA', value: (c) => mediaClipMediaLabel(c) },
          { header: 'TYPE', value: (c) => String(c.type) },
          { header: 'START', value: (c) => `${c.start.toFixed(2)}s` },
          { header: 'END', value: (c) => `${c.end.toFixed(2)}s` },
          { header: 'DURATION', value: (c) => formatDuration(c.duration) },
        ],
        { json: opts.json, totalItems: result.totalItems }
      );
    } catch (err) {
      handleError(err);
    }
  });

  const clipUpdate = clip
    .command('update <clipId>')
    .description('Update a media clip (label, description, trim)');

  applyOptions(withJsonOption(clipUpdate), mediaClipUpdateOptions).action(
    async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const updated = await updateMediaClip(
          pb,
          clipId,
          pickOptions(opts, mediaClipUpdateOptions)
        );
        if (opts.json) {
          printRecord(updated, [], true);
          return;
        }
        const label = updated.label ? ` "${updated.label}"` : '';
        success(
          `Updated clip ${updated.id}${label} (${updated.start.toFixed(2)}s–${updated.end.toFixed(2)}s, ${formatDuration(updated.duration)})`
        );
      } catch (err) {
        handleError(err);
      }
    }
  );

  withJsonOption(
    clip
      .command('delete <clipId>')
      .alias('rm')
      .description('Delete a media clip')
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await deleteMediaClip(pb, clipId);
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      success(`Deleted clip ${result.clip.id}`);
      if (result.referencingClipIds.length > 0) {
        info(
          `  ${result.referencingClipIds.length} timeline clip(s) now have a dangling ` +
            `MediaClip ref (${result.referencingClipIds.join(', ')}) — provenance only, playback/rendering unaffected.`
        );
      }
    } catch (err) {
      handleError(err);
    }
  });
}
