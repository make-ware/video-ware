import type { Command } from 'commander';
import {
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
  fetchMediaClipPage,
  fetchMediaPage,
  mediaClipListSpec,
  mediaClipUpdateOptions,
  mediaFieldOptions,
  mediaListSpec,
  updateMedia,
  updateMediaClip,
} from '../lib/media.js';
import { registerMediaClipSegmentCommands } from './clip-segments.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import { runList, withListOptions } from '../lib/list/index.js';
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

  withListOptions(
    media
      .command('list')
      .alias('ls')
      .description(
        'List media in the active workspace (narrow with --search/--type/-d)'
      ),
    mediaListSpec
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const ctx = {
        pb,
        workspaceId: await resolveWorkspaceId(pb, opts.workspace),
      };
      await runList({
        spec: mediaListSpec,
        opts,
        ctx,
        fetchPage: (query) => fetchMediaPage(pb, query),
      });
    } catch (err) {
      handleError(err);
    }
  });

  // `media search <query>` is `media list --search <query>`: the same spec with
  // the query supplied positionally, kept as its own command for discoverability.
  withListOptions(
    media
      .command('search <query>')
      .alias('find')
      .description('Search workspace media by filename, label, or description'),
    { ...mediaListSpec, command: 'media search' }
  ).action(async (query: string, opts) => {
    try {
      const pb = await requireClient();
      const ctx = {
        pb,
        workspaceId: await resolveWorkspaceId(pb, opts.workspace),
      };
      await runList({
        spec: { ...mediaListSpec, command: 'media search' },
        opts: { ...opts, search: opts.search ?? query },
        ctx,
        fetchPage: (resolved) => fetchMediaPage(pb, resolved),
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

  withListOptions(
    clip
      .command('list')
      .alias('ls')
      .description('List media clips in the active workspace'),
    mediaClipListSpec
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      if (opts.media && opts.directory !== undefined) {
        throw new Error(
          '-m already pins one media (and its directory) — drop -d or -m.'
        );
      }
      const ctx = {
        pb,
        workspaceId: await resolveWorkspaceId(pb, opts.workspace),
      };
      await runList({
        spec: mediaClipListSpec,
        opts,
        ctx,
        fetchPage: (query) => fetchMediaClipPage(pb, query),
      });
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
}
