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
  createMediaClip,
  mediaClipMediaLabel,
  parseClipType,
  searchMediaByName,
  type MediaClipWithMedia,
} from '../lib/media.js';
import { formatDuration, info, success, table } from '../lib/output.js';

/** Shared column layout for `media list` and `media search`. */
const mediaColumns = [
  { header: 'ID', value: (m: MediaWithUpload) => m.id },
  { header: 'NAME', value: (m: MediaWithUpload) => mediaLabel(m) },
  { header: 'TYPE', value: (m: MediaWithUpload) => String(m.mediaType) },
  {
    header: 'DURATION',
    value: (m: MediaWithUpload) => formatDuration(m.duration),
  },
  { header: 'SIZE', value: (m: MediaWithUpload) => `${m.width}x${m.height}` },
];

export function registerMediaCommands(program: Command): void {
  const media = program.command('media').description('Browse workspace media');

  media
    .command('list')
    .alias('ls')
    .description('List media in the active workspace')
    .option('-w, --workspace <id>', 'workspace id override')
    .action(async (opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
        const result = await new MediaMutator(pb).getByWorkspace(
          workspaceId,
          1,
          200
        );
        table(result.items as MediaWithUpload[], mediaColumns);
      } catch (err) {
        handleError(err);
      }
    });

  media
    .command('search <query>')
    .alias('find')
    .description('Search workspace media by upload filename')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-n, --limit <count>', 'max results (default: 50)', (v) =>
      parseInt(v, 10)
    )
    .action(async (query: string, opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
        const result = await searchMediaByName(
          pb,
          workspaceId,
          query,
          opts.limit ?? 50
        );
        table(result.items as MediaWithUpload[], mediaColumns);
      } catch (err) {
        handleError(err);
      }
    });

  const clip = media
    .command('clip')
    .description(
      'Create and browse media clips (reusable sub-ranges of media)'
    );

  clip
    .command('create')
    .description('Create a media clip from a media sub-range')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'source media id')
    .option('-s, --start <seconds>', 'clip start in source media', parseFloat)
    .option('-e, --end <seconds>', 'clip end in source media', parseFloat)
    .option('--type <type>', 'clip type (default: user)')
    .action(async (opts) => {
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
          start: opts.start,
          end: opts.end,
          type: opts.type ? parseClipType(opts.type) : undefined,
        });
        success(
          `Created ${created.type} clip ${created.id} (${created.start}s–${created.end}s, ${formatDuration(created.duration)}) from media ${mediaId}`
        );
      } catch (err) {
        handleError(err);
      }
    });

  clip
    .command('list')
    .alias('ls')
    .description('List media clips in the active workspace')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'filter to a single source media')
    .option('--type <type>', 'filter by clip type')
    .option('--search <query>', 'filter by clip type or media filename')
    .action(async (opts) => {
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

        table(result.items as MediaClipWithMedia[], [
          { header: 'ID', value: (c) => c.id },
          { header: 'MEDIA', value: (c) => mediaClipMediaLabel(c) },
          { header: 'TYPE', value: (c) => String(c.type) },
          { header: 'START', value: (c) => `${c.start.toFixed(2)}s` },
          { header: 'END', value: (c) => `${c.end.toFixed(2)}s` },
          { header: 'DURATION', value: (c) => formatDuration(c.duration) },
        ]);

        if (opts.media) {
          info(`(${result.totalItems} clip(s) for media ${opts.media})`);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
