import type { Command } from 'commander';
import {
  MediaClipMutator,
  MediaMutator,
  MediaTagMutator,
  type Entity,
  type MediaTag,
  type TypedPocketBase,
} from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import {
  mediaLabel,
  pickMedia,
  resolveWorkspaceId,
  type MediaWithUpload,
} from '../lib/select.js';
import { resolveEntity } from '../lib/entity.js';
import {
  clipFieldOptions,
  createMediaClip,
  deleteMediaClip,
  mediaClipMediaLabel,
  mediaClipUpdateOptions,
  mediaColumns,
  mediaFieldOptions,
  parseClipType,
  searchMedia,
  updateMedia,
  updateMediaClip,
  type MediaClipWithMedia,
} from '../lib/media.js';
import { isRootDirRef, resolveDirectory } from '../lib/directory.js';
import {
  compositeMarker,
  mediaClipTimes,
  type ClipTimes,
} from '../lib/clip-times.js';
import { registerMediaClipSegmentCommands } from './clip-segments.js';
import { registerMediaClipTranscriptCommand } from './clip-transcript.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  formatDuration,
  info,
  printList,
  printRecord,
  success,
  type Column,
} from '../lib/output.js';

/** A media tag with its entity expanded for display. */
type MediaTagWithEntity = MediaTag & { expand?: { EntityRef?: Entity } };

const tagColumns: Column<MediaTagWithEntity>[] = [
  { header: 'ENTITY', value: (t) => t.expand?.EntityRef?.name ?? t.EntityRef },
  { header: 'KIND', value: (t) => String(t.expand?.EntityRef?.kind ?? '?') },
  { header: 'ENTITY ID', value: (t) => t.EntityRef },
];

async function requireMedia(
  pb: TypedPocketBase,
  mediaId: string
): Promise<MediaWithUpload> {
  const media = await new MediaMutator(pb).getById(mediaId);
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }
  return media as MediaWithUpload;
}

export function registerMediaCommands(program: Command): void {
  const media = program.command('media').description('Browse workspace media');

  withJsonOption(
    media
      .command('list')
      .alias('ls')
      .description(
        'List media in the active workspace (all of it unless -d filters to one directory)'
      )
      .option('-w, --workspace <id>', 'workspace id override')
      .option(
        '-d, --directory <dir>',
        'optional filter: only media in this directory (name or id; "/" = unfiled media at the workspace root)'
      )
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const mutator = new MediaMutator(pb);
      const result =
        opts.directory === undefined
          ? await mutator.getByWorkspace(workspaceId, 1, 200, 'DirectoryRef')
          : isRootDirRef(opts.directory)
            ? await mutator.getByWorkspaceRoot(
                workspaceId,
                1,
                200,
                'DirectoryRef'
              )
            : await mutator.getByDirectory(
                (await resolveDirectory(pb, workspaceId, opts.directory)).id,
                1,
                200,
                'DirectoryRef'
              );
      const items = result.items as MediaWithUpload[];
      printList(items, mediaColumns(items), {
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
      .option(
        '-d, --directory <dir>',
        'optional filter: only media in this directory (name or id; "/" = unfiled media at the workspace root)'
      )
      .option('-n, --limit <count>', 'max results (default: 50)', (v) =>
        parseInt(v, 10)
      )
  ).action(async (query: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const directoryId =
        opts.directory === undefined
          ? undefined
          : isRootDirRef(opts.directory)
            ? null
            : (await resolveDirectory(pb, workspaceId, opts.directory)).id;
      const result = await searchMedia(
        pb,
        workspaceId,
        query,
        opts.limit ?? 50,
        directoryId
      );
      const items = result.items as MediaWithUpload[];
      printList(items, mediaColumns(items), {
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
    .description(
      'Set a media item’s editor-facing label/description, or move it into a directory'
    );

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

  const mediaShow = media
    .command('show <mediaId>')
    .description('Show one media item with its entity tags');
  withJsonOption(mediaShow).action(async (mediaId: string, opts) => {
    try {
      const pb = await requireClient();
      const found = await requireMedia(pb, mediaId);
      const tags = await new MediaTagMutator(pb).getByMedia(
        found.id,
        1,
        100,
        'EntityRef'
      );

      if (opts.json) {
        printRecord({ ...found, tags: tags.items }, [], true);
        return;
      }
      info(
        `media ${found.id} "${mediaLabel(found)}" — ${found.mediaType} ` +
          `${formatDuration(found.duration)} ${found.width}x${found.height}`
      );
      if (found.label) info(`label: ${found.label}`);
      if (found.description) info(found.description);
      if (tags.items.length === 0) {
        info(
          'no entity tags — vw media tag <mediaId> <entity> tags this media with an entity'
        );
        return;
      }
      info(
        `tagged with ${tags.totalItems} ${tags.totalItems === 1 ? 'entity' : 'entities'}:`
      );
      printList(tags.items as MediaTagWithEntity[], tagColumns, {
        totalItems: tags.totalItems,
        hint: 'vw media untag <mediaId> <entity> removes a tag',
      });
    } catch (err) {
      handleError(err);
    }
  });

  const mediaTag = media
    .command('tag <mediaId> <entityNameOrId>')
    .description(
      'Tag a media item with an entity ("this media features X") — a whole-media link, unlike vw label tag which attributes one detection'
    );
  withJsonOption(mediaTag).action(
    async (mediaId: string, entityNameOrId: string, opts) => {
      try {
        const pb = await requireClient();
        const found = await requireMedia(pb, mediaId);
        const entity = await resolveEntity(
          pb,
          found.WorkspaceRef,
          entityNameOrId
        );
        const tag = await new MediaTagMutator(pb).tag({
          WorkspaceRef: found.WorkspaceRef,
          MediaRef: found.id,
          EntityRef: entity.id,
        });
        if (opts.json) {
          printRecord({ ...tag, entity }, [], true);
          return;
        }
        success(
          `Tagged media ${found.id} "${mediaLabel(found)}" → ` +
            `${entity.kind} "${entity.name}"`
        );
      } catch (err) {
        handleError(err);
      }
    }
  );

  const mediaUntag = media
    .command('untag <mediaId> <entityNameOrId>')
    .description('Remove an entity tag from a media item (no-op if absent)');
  withJsonOption(mediaUntag).action(
    async (mediaId: string, entityNameOrId: string, opts) => {
      try {
        const pb = await requireClient();
        const found = await requireMedia(pb, mediaId);
        const entity = await resolveEntity(
          pb,
          found.WorkspaceRef,
          entityNameOrId
        );
        const removed = await new MediaTagMutator(pb).untag(
          found.id,
          entity.id
        );
        if (opts.json) {
          printRecord({ removed, MediaRef: found.id, entity }, [], true);
          return;
        }
        if (removed) {
          success(
            `Untagged media ${found.id} "${mediaLabel(found)}" — removed ` +
              `${entity.kind} "${entity.name}"`
          );
        } else {
          info(
            `Media ${found.id} was not tagged with "${entity.name}" — nothing to do`
          );
        }
      } catch (err) {
        handleError(err);
      }
    }
  );

  const clip = media
    .command('clip')
    .description(
      'Create and browse media clips (reusable sub-ranges of media) — clips have no directory of their own; they follow their parent media'
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
      .option(
        '-d, --directory <dir>',
        'optional filter: only clips whose source media is in this directory (name or id; "/" = unfiled media)'
      )
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const mutator = new MediaClipMutator(pb);
      if (opts.media && opts.directory !== undefined) {
        throw new Error(
          '-m already pins one media (and its directory) — drop -d or -m.'
        );
      }
      const directoryId =
        opts.directory === undefined
          ? undefined
          : isRootDirRef(opts.directory)
            ? 'root'
            : (await resolveDirectory(pb, workspaceId, opts.directory)).id;

      const result = opts.media
        ? await mutator.getByMedia(opts.media, 1, 200)
        : await mutator.getByWorkspace(workspaceId, 1, 200, {
            type: opts.type ? parseClipType(opts.type) : undefined,
            searchQuery: opts.search,
            directoryId,
          });

      const rows = (result.items as MediaClipWithMedia[]).map((c) => ({
        ...c,
        times: mediaClipTimes(c),
      })) as Array<MediaClipWithMedia & { times: ClipTimes }>;
      printList(
        rows,
        [
          { header: 'ID', value: (c) => c.id },
          { header: 'LABEL', value: (c) => c.label ?? '' },
          { header: 'MEDIA', value: (c) => mediaClipMediaLabel(c) },
          { header: 'TYPE', value: (c) => String(c.type) },
          { header: 'START', value: (c) => `${c.start.toFixed(2)}s` },
          { header: 'END', value: (c) => `${c.end.toFixed(2)}s` },
          {
            // Effective gap-skipping length; ` ◆N` marks an N-segment
            // composite whose START–END span is larger than it plays.
            header: 'DURATION',
            value: (c) =>
              `${c.duration.toFixed(2)}s${compositeMarker(c.times)}`,
          },
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

  registerMediaClipSegmentCommands(clip);
  registerMediaClipTranscriptCommand(clip);
}
