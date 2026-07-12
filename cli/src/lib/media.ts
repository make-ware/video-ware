import type { ListResult } from 'pocketbase';
import {
  ClipType,
  MediaClipMutator,
  MediaMutator,
  TimelineClipMutator,
  clampSegmentsToWindow,
  deriveClipTimes,
  getCompositeSegments,
  validateTimeRange,
  type Media,
  type MediaClip,
  type MediaClipInput,
  type TypedPocketBase,
} from '@project/shared';
import { mediaBounds, singleMediaType } from './timeline.js';
import { mediaLabel, type MediaWithUpload } from './select.js';
import { resolveDirectory } from './directory.js';
import type { OptionGroupOf } from './options.js';
import { formatDuration, type Column } from './output.js';

/** MediaClip expanded with its source media (and that media's upload). */
export type MediaClipWithMedia = MediaClip & {
  expand?: { MediaRef?: MediaWithUpload };
};

/** Human-readable label for a clip's source media. */
export function mediaClipMediaLabel(clip: MediaClipWithMedia): string {
  return clip.expand?.MediaRef?.expand?.UploadRef?.name ?? clip.MediaRef;
}

/**
 * Column layout shared by `media list` and `media search`. The DIRECTORY
 * column is appended only when at least one row actually has a directory set,
 * so workspaces that don't use directories keep the compact table.
 */
export function mediaColumns(
  items: MediaWithUpload[]
): Column<MediaWithUpload>[] {
  const columns: Column<MediaWithUpload>[] = [
    { header: 'ID', value: (m) => m.id },
    { header: 'NAME', value: (m) => mediaLabel(m) },
    { header: 'LABEL', value: (m) => m.label ?? '' },
    { header: 'TYPE', value: (m) => String(m.mediaType) },
    { header: 'DURATION', value: (m) => formatDuration(m.duration) },
    { header: 'SIZE', value: (m) => `${m.width}x${m.height}` },
  ];
  if (items.some((m) => m.DirectoryRef)) {
    columns.push({
      header: 'DIRECTORY',
      value: (m) => m.expand?.DirectoryRef?.name ?? m.DirectoryRef ?? '',
    });
  }
  return columns;
}

/**
 * Search a workspace's media by its label, description, or source upload
 * filename, optionally narrowed to a single directory. Mirrors the webapp's
 * metadata search: the free-text `query` is bound via `pb.filter` to avoid
 * filter-string injection.
 */
export async function searchMedia(
  pb: TypedPocketBase,
  workspaceId: string,
  query: string,
  perPage = 50,
  directoryId?: string
): Promise<ListResult<Media>> {
  const search =
    '(label ~ {:q} || description ~ {:q} || UploadRef.name ~ {:q})';
  const filter = directoryId
    ? pb.filter(`WorkspaceRef = {:ws} && DirectoryRef = {:dir} && ${search}`, {
        ws: workspaceId,
        dir: directoryId,
        q: query,
      })
    : pb.filter(`WorkspaceRef = {:ws} && ${search}`, {
        ws: workspaceId,
        q: query,
      });
  return new MediaMutator(pb).getList(1, perPage, filter, undefined, [
    'DirectoryRef',
  ]);
}

/** Validate a clip type string against the ClipType enum. */
export function parseClipType(value: string): ClipType {
  const types = Object.values(ClipType) as string[];
  if (!types.includes(value)) {
    throw new Error(
      `Invalid clip type "${value}". Valid types: ${types.join(', ')}`
    );
  }
  return value as ClipType;
}

export interface CreateMediaClipOptions {
  mediaId: string;
  /** Clip start in source media (seconds). Defaults to 0. */
  start?: number;
  /** Clip end in source media (seconds). Defaults to the media duration. */
  end?: number;
  /** Clip type. Defaults to ClipType.USER. */
  type?: ClipType;
  /** Editor-facing clip name (searchable). */
  label?: string;
  /** Editor-facing clip notes (searchable). */
  description?: string;
  /** Workspace id. Defaults to the source media's workspace. */
  workspaceId?: string;
}

/**
 * `media clip create` flags for the optional MediaClip fields above. The
 * `satisfies` clause locks keys and parsed value types to
 * CreateMediaClipOptions, so flags, options object, and mutator input stay in
 * sync. To expose a new field: add it to the interface, map it in
 * createMediaClip, and add a spec here — commands pick it up via
 * applyOptions/pickOptions.
 */
export const clipFieldOptions = {
  start: {
    flags: '-s, --start <seconds>',
    description: 'clip start in source media',
    parse: parseFloat,
  },
  end: {
    flags: '-e, --end <seconds>',
    description: 'clip end in source media',
    parse: parseFloat,
  },
  type: {
    flags: '--type <type>',
    description: 'clip type (default: user)',
    parse: parseClipType,
  },
  label: {
    flags: '--label <text>',
    description: 'clip name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'clip notes shown in the editor (searchable)',
  },
} satisfies OptionGroupOf<CreateMediaClipOptions>;

/**
 * Create a MediaClip — a reusable sub-range of a single media — built directly
 * on the shared MediaClipMutator. Defaults to a USER clip spanning the whole
 * media when no range is given.
 */
export async function createMediaClip(
  pb: TypedPocketBase,
  opts: CreateMediaClipOptions
): Promise<MediaClip> {
  const media = await new MediaMutator(pb).getById(opts.mediaId);
  if (!media) {
    throw new Error(`Media not found: ${opts.mediaId}`);
  }

  const start = opts.start ?? 0;
  const end = opts.end ?? media.duration;
  const mediaType = singleMediaType(media.mediaType);

  if (!validateTimeRange(start, end, media.duration, mediaType)) {
    throw new Error(
      `Invalid time range: start=${start}, end=${end}, media duration=${media.duration}`
    );
  }

  const input: MediaClipInput = {
    WorkspaceRef: opts.workspaceId ?? media.WorkspaceRef,
    MediaRef: opts.mediaId,
    type: opts.type ?? ClipType.USER,
    label: opts.label,
    description: opts.description,
    start,
    end,
    duration: end - start,
    version: 1,
  };

  return new MediaClipMutator(pb).create(input);
}

export interface UpdateMediaClipOptions {
  /** Editor-facing clip name (searchable). */
  label?: string;
  /** Editor-facing clip notes (searchable). */
  description?: string;
  /** New clip start in source media (seconds). */
  start?: number;
  /** New clip end in source media (seconds). */
  end?: number;
}

/** `media clip update` flags for the editable MediaClip fields. */
export const mediaClipUpdateOptions = {
  label: {
    flags: '--label <text>',
    description: 'clip name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'clip notes shown in the editor (searchable)',
  },
  start: {
    flags: '-s, --start <seconds>',
    description: 'new clip start in source media',
    parse: parseFloat,
  },
  end: {
    flags: '-e, --end <seconds>',
    description: 'new clip end in source media',
    parse: parseFloat,
  },
} satisfies OptionGroupOf<UpdateMediaClipOptions>;

/**
 * Patch a MediaClip's label/description/trim. A trim change (start and/or
 * end) is re-validated against the source media and recomputes the stored
 * duration. On a composite clip the trim window intersects the edit list
 * instead of overwriting it — duration stays the effective (gap-skipping)
 * length, not end - start. Only the fields actually passed are written.
 */
export async function updateMediaClip(
  pb: TypedPocketBase,
  clipId: string,
  opts: UpdateMediaClipOptions
): Promise<MediaClip> {
  const mutator = new MediaClipMutator(pb);
  const clip = await mutator.getById(clipId);
  if (!clip) {
    throw new Error(`Media clip not found: ${clipId}`);
  }

  const patch: Partial<MediaClip> = {
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
  };

  const trimChanged = opts.start !== undefined || opts.end !== undefined;
  if (trimChanged) {
    const start = opts.start ?? clip.start;
    const end = opts.end ?? clip.end;

    const media = await new MediaMutator(pb).getById(clip.MediaRef);
    if (!media) {
      throw new Error(
        `Clip ${clipId} references missing media ${clip.MediaRef}.`
      );
    }
    const mediaType = singleMediaType(media.mediaType);
    if (!validateTimeRange(start, end, media.duration, mediaType)) {
      throw new Error(
        `Invalid time range: start=${start}, end=${end}, media duration=${media.duration}`
      );
    }

    const segments = getCompositeSegments(clip);
    if (segments && segments.length > 0) {
      const clamped = clampSegmentsToWindow(
        segments,
        start,
        end,
        mediaBounds(media)
      );
      if (clamped.length === 0) {
        throw new Error(
          `Trim window ${start}–${end}s contains no segment content — ` +
            `inspect the edit list with \`vw media clip segments ${clipId}\`.`
        );
      }
      const times = deriveClipTimes(clamped);
      patch.start = times.start;
      patch.end = times.end;
      patch.duration = times.duration;
      // merge, never replace: update() skips validation, so unknown keys
      // like gapThreshold survive — keep it that way
      patch.clipData = { ...(clip.clipData ?? {}), segments: clamped };
    } else {
      patch.start = start;
      patch.end = end;
      patch.duration = end - start;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to update — pass at least one field flag.');
  }

  return mutator.update(clipId, patch);
}

export interface DeleteMediaClipResult {
  clip: MediaClip;
  /** Timeline clip ids that reference this MediaClip (provenance only). */
  referencingClipIds: string[];
}

/**
 * Delete a MediaClip. Unlike `caption delete`, this never refuses: a
 * TimelineClip's `MediaClipRef` is provenance only (`timeline doctor` flags a
 * dangling one as a warning, not an error — playback and rendering are
 * unaffected), and PocketBase cascade-deletes any MediaClipLabels rows that
 * linked the clip back to its source label. Referencing timeline clip ids
 * are reported either way so the caller can follow up.
 */
export async function deleteMediaClip(
  pb: TypedPocketBase,
  clipId: string
): Promise<DeleteMediaClipResult> {
  const mutator = new MediaClipMutator(pb);
  const clip = await mutator.getById(clipId);
  if (!clip) {
    throw new Error(`Media clip not found: ${clipId}`);
  }

  const refs = await new TimelineClipMutator(pb).getList(
    1,
    500,
    pb.filter('MediaClipRef = {:id}', { id: clipId })
  );
  const referencingClipIds = refs.items.map((c) => c.id);

  await mutator.delete(clipId);
  return { clip, referencingClipIds };
}

export interface UpdateMediaOptions {
  /** Editor-facing media name (searchable). */
  label?: string;
  /** Editor-facing media notes (searchable). */
  description?: string;
  /** Directory name or id to move the media into; 'none' clears it. */
  directory?: string;
}

/**
 * `media update` flags for the editor-facing Media fields. The `satisfies`
 * clause locks keys and parsed value types to UpdateMediaOptions, so flags,
 * options object, and mutator patch stay in sync — mirrors clipFieldOptions.
 */
export const mediaFieldOptions = {
  label: {
    flags: '--label <text>',
    description: 'media name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'media notes shown in the editor (searchable)',
  },
  directory: {
    flags: '--directory <nameOrId>',
    description: "move the media into a directory ('none' clears it)",
  },
} satisfies OptionGroupOf<UpdateMediaOptions>;

/**
 * Patch a media's editor-facing label/description/directory. Only the fields
 * actually passed are written, so an unset flag leaves the stored value
 * untouched. `--directory` resolves a name or id within the media's own
 * workspace; the literal 'none' (or an empty value) detaches the media back
 * to the workspace root.
 */
export async function updateMedia(
  pb: TypedPocketBase,
  mediaId: string,
  opts: UpdateMediaOptions
): Promise<Media> {
  const mutator = new MediaMutator(pb);
  const media = await mutator.getById(mediaId);
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const patch: Partial<Media> = {
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
  };

  if (opts.directory !== undefined) {
    patch.DirectoryRef =
      opts.directory === '' || opts.directory === 'none'
        ? ''
        : (await resolveDirectory(pb, media.WorkspaceRef, opts.directory)).id;
  }

  return mutator.update(mediaId, patch);
}
