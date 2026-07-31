import type { ListResult } from 'pocketbase';
import {
  ClipType,
  MediaClipMutator,
  MediaMutator,
  MediaType,
  TimelineClipMutator,
  clampSegmentsToWindow,
  finalizeSegments,
  getCompositeSegments,
  validateTimeRange,
  type CropRect,
  type Directory,
  type Media,
  type MediaClip,
  type MediaClipInput,
  type TypedPocketBase,
} from '@project/shared';
import { mediaBounds, singleMediaType } from './timeline.js';
import {
  mediaLabel,
  requireMediaClip,
  type MediaWithUpload,
} from './select.js';
import { isRootDirRef, resolveDirectory } from './directory.js';
import {
  compositeMarker,
  mediaClipTimes,
  type ClipTimes,
} from './clip-times.js';
import { parseCropRect, type OptionGroupOf } from './options.js';
import { formatDuration, type Column } from './output.js';
import {
  MEDIA_CLIP_SORTS,
  MEDIA_SORTS,
  listFilter,
  type ListSpec,
} from './list/index.js';

/** MediaClip expanded with its source media (and that media's upload). */
export type MediaClipWithMedia = MediaClip & {
  expand?: { MediaRef?: MediaWithUpload };
};

/** Human-readable label for a clip's source media. */
export function mediaClipMediaLabel(clip: MediaClipWithMedia): string {
  const media = clip.expand?.MediaRef;
  return media ? mediaLabel(media) : clip.MediaRef;
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

/** Validate a media type string against the MediaType enum. */
export function parseMediaType(value: string): MediaType {
  const types = Object.values(MediaType) as string[];
  if (!types.includes(value)) {
    throw new Error(
      `Invalid media type "${value}". Valid types: ${types.join(', ')}`
    );
  }
  return value as MediaType;
}

/**
 * Narrow a list to one directory, or to unfiled media at the workspace root.
 * Shared by `media list` and `media clip list` (whose clips follow their
 * parent media's directory), so the `/`-means-root convention is declared
 * once.
 */
const directoryFilter = (field: string) =>
  listFilter({
    flags: '-d, --directory <dir>',
    description:
      'only this directory (name or id; "/" = unfiled media at the workspace root)',
    clause: async (ref, { pb, workspaceId }) =>
      isRootDirRef(ref)
        ? { expr: `${field} = ""` }
        : {
            expr: `${field} = {:dir}`,
            params: { dir: (await resolveDirectory(pb, workspaceId!, ref)).id },
          },
  });

/**
 * Free-text search over a media's editor-facing metadata and its source
 * filename — the same fields the webapp's media search matches
 * (`use-media-list.ts`), bound through `pb.filter` so a query can never
 * inject filter syntax.
 */
const mediaSearchFilter = listFilter({
  flags: '--search <text>',
  description: "match the media's label, description, or source filename",
  clause: (q) => ({
    expr: '(label ~ {:q} || description ~ {:q} || name ~ {:q})',
    params: { q },
  }),
});

/**
 * `media list` / `media search`. Both are the same query — `search` is one
 * more filter — so `vw media search foo` is exactly
 * `vw media list --search foo`.
 */
export const mediaListSpec: ListSpec<MediaWithUpload> = {
  command: 'media list',
  sorts: MEDIA_SORTS,
  // The pre-pagination handler read a fixed 200 rows; keep that page size so
  // scripts that read `.items` without checking `hasMore` see no fewer rows.
  defaultLimit: 200,
  filters: {
    directory: directoryFilter('DirectoryRef'),
    type: listFilter({
      flags: '--type <mediaType>',
      description: `only this media type (${Object.values(MediaType).join(', ')})`,
      parse: parseMediaType,
      clause: (type) => ({ expr: 'mediaType = {:t}', params: { t: type } }),
    }),
    search: mediaSearchFilter,
  },
  columns: (rows) => mediaColumns(rows),
  hint: '`vw media show <id>` for one record with its entity tags',
};

/** Fetch one page of media for `mediaListSpec`. */
export function fetchMediaPage(
  pb: TypedPocketBase,
  query: { page: number; perPage: number; filter: string; sort: string }
): Promise<ListResult<MediaWithUpload>> {
  return new MediaMutator(pb).getList(
    query.page,
    query.perPage,
    query.filter,
    query.sort,
    ['DirectoryRef', 'UploadRef']
  ) as Promise<ListResult<MediaWithUpload>>;
}

/** A listed clip with its derived time semantics, for the ◆N marker. */
export type MediaClipRow = MediaClipWithMedia & { times: ClipTimes };

/** `media clip list` — clips are addressed per media or across the workspace. */
export const mediaClipListSpec: ListSpec<MediaClipWithMedia, MediaClipRow> = {
  command: 'media clip list',
  sorts: MEDIA_CLIP_SORTS,
  // Pre-pagination page size — see mediaListSpec.
  defaultLimit: 200,
  filters: {
    media: listFilter({
      flags: '-m, --media <id>',
      description: 'only clips of this source media',
      clause: (id) => ({ expr: 'MediaRef = {:m}', params: { m: id } }),
    }),
    // A clip has no directory of its own — it follows its parent media, so the
    // filter reaches through the relation.
    directory: directoryFilter('MediaRef.DirectoryRef'),
    type: listFilter({
      flags: '--type <type>',
      description: `only this clip type (${Object.values(ClipType).join(', ')})`,
      parse: parseClipType,
      clause: (type) => ({ expr: 'type = {:t}', params: { t: type } }),
    }),
    search: listFilter({
      flags: '--search <query>',
      description: "match the clip's label, description, or source filename",
      clause: (q) => ({
        expr: '(label ~ {:q} || description ~ {:q} || MediaRef.name ~ {:q})',
        params: { q },
      }),
    }),
  },
  toRows: (clips) => clips.map((c) => ({ ...c, times: mediaClipTimes(c) })),
  columns: [
    { header: 'ID', value: (c) => c.id },
    { header: 'LABEL', value: (c) => c.label ?? '' },
    { header: 'MEDIA', value: (c) => mediaClipMediaLabel(c) },
    { header: 'TYPE', value: (c) => String(c.type) },
    { header: 'START', value: (c) => `${c.start.toFixed(2)}s` },
    { header: 'END', value: (c) => `${c.end.toFixed(2)}s` },
    {
      // Effective gap-skipping length; ` ◆N` marks an N-segment composite
      // whose START–END span is larger than it plays.
      header: 'DURATION',
      value: (c) => `${c.duration.toFixed(2)}s${compositeMarker(c.times)}`,
    },
  ],
  hint: '`vw media clip segments <id>` shows a composite clip’s edit list',
};

/** Fetch one page of media clips for `mediaClipListSpec`. */
export function fetchMediaClipPage(
  pb: TypedPocketBase,
  query: { page: number; perPage: number; filter: string; sort: string }
): Promise<ListResult<MediaClipWithMedia>> {
  return new MediaClipMutator(pb).getList(
    query.page,
    query.perPage,
    query.filter,
    query.sort,
    ['MediaRef.UploadRef']
  ) as Promise<ListResult<MediaClipWithMedia>>;
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
 * length, not end - start. A window that keeps only one segment collapses
 * the list: the clip reverts to a plain start/end trim. Only the fields
 * actually passed are written.
 */
export async function updateMediaClip(
  pb: TypedPocketBase,
  clipId: string,
  opts: UpdateMediaClipOptions
): Promise<MediaClip> {
  const mutator = new MediaClipMutator(pb);
  const clip = await requireMediaClip(pb, clipId);

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
    if (segments) {
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
      // A window that keeps only one segment collapses the edit list — the
      // clip reverts to a plain start/end trim (finalizeSegments invariant).
      const finalized = finalizeSegments(clamped, mediaBounds(media));
      patch.start = finalized.start;
      patch.end = finalized.end;
      patch.duration = finalized.duration;
      // merge, never replace: update() skips validation, so unknown keys
      // like gapThreshold survive — keep it that way
      const clipData: Record<string, unknown> = { ...(clip.clipData ?? {}) };
      if (finalized.segments) {
        clipData.segments = finalized.segments;
      } else {
        delete clipData.segments;
      }
      patch.clipData = clipData;
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
  const clip = await requireMediaClip(pb, clipId);

  const refs = await new TimelineClipMutator(pb).getList(
    1,
    500,
    pb.filter('MediaClipRef = {:id}', { id: clipId })
  );
  const referencingClipIds = refs.items.map((c) => c.id);

  await mutator.delete(clipId);
  return { clip, referencingClipIds };
}

export interface MoveMediaResult {
  /** Target directory, or null when the media were moved to the workspace root. */
  directory: Directory | null;
  moved: Media[];
}

/**
 * Move one or more media into a directory — or back to the workspace root
 * when `directoryRef` is a root ref (`/`, `root`, `none`). Every media is
 * validated (exists, same workspace) before anything is written, so a bad id
 * doesn't leave the batch half-moved.
 */
export async function moveMedia(
  pb: TypedPocketBase,
  workspaceId: string,
  directoryRef: string,
  mediaIds: string[]
): Promise<MoveMediaResult> {
  const directory: Directory | null = isRootDirRef(directoryRef)
    ? null
    : await resolveDirectory(pb, workspaceId, directoryRef);

  const mutator = new MediaMutator(pb);
  const targets: Media[] = [];
  for (const id of mediaIds) {
    const media = await mutator.getById(id);
    if (!media) {
      throw new Error(`Media not found: ${id} — nothing was moved.`);
    }
    if (media.WorkspaceRef !== workspaceId) {
      throw new Error(
        `Media ${id} belongs to another workspace — nothing was moved.`
      );
    }
    targets.push(media);
  }

  const moved: Media[] = [];
  for (const media of targets) {
    moved.push(
      await mutator.update(media.id, {
        DirectoryRef: directory?.id ?? '',
      } as Partial<Media>)
    );
  }
  return { directory, moved };
}

export interface UpdateMediaOptions {
  /** Editor-facing media name (searchable). */
  label?: string;
  /** Editor-facing media notes (searchable). */
  description?: string;
  /** Directory name or id to move the media into; '/' or 'none' clears it. */
  directory?: string;
  /**
   * Default source crop for every placement (e.g. strip letterbox bars):
   * 0–1 fractions of the display frame (post-rotation).
   */
  crop?: CropRect;
  /** Remove the default crop — placements fall back to the full frame. */
  clearCrop?: boolean;
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
    flags: '--directory <dir>',
    description:
      "move the media into a directory (name or id; '/' or 'none' clears it)",
  },
  crop: {
    flags: '--crop <l,t,w,h>',
    description:
      'default source crop for every placement, 0-1 display-frame ' +
      'fractions (e.g. strip letterbox bars: 0,0.12,1,0.76)',
    parse: parseCropRect,
  },
  // clearCrop is a bare boolean flag — registered with .option() on the
  // command directly (option groups carry value-taking flags only).
} satisfies OptionGroupOf<UpdateMediaOptions>;

/**
 * Patch a media's editor-facing label/description/directory. Only the fields
 * actually passed are written, so an unset flag leaves the stored value
 * untouched. `--directory` resolves a name or id within the media's own
 * workspace; a root ref ('/', 'root', 'none', or an empty value) detaches
 * the media back to the workspace root.
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
    patch.DirectoryRef = isRootDirRef(opts.directory)
      ? ''
      : (await resolveDirectory(pb, media.WorkspaceRef, opts.directory)).id;
  }

  if (opts.crop !== undefined && opts.clearCrop) {
    throw new Error('--crop and --clear-crop are mutually exclusive.');
  }
  if (opts.crop !== undefined || opts.clearCrop) {
    if (media.mediaType === 'audio') {
      throw new Error('Audio media has no frame to crop.');
    }
    // PocketBase clears a JSON column with null; the mutator's update path
    // doesn't re-validate, and --crop input was already bounded by the parser.
    patch.crop = opts.clearCrop
      ? (null as unknown as Media['crop'])
      : opts.crop;
  }

  return mutator.update(mediaId, patch);
}
