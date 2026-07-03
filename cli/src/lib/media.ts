import type { ListResult } from 'pocketbase';
import {
  ClipType,
  MediaClipMutator,
  MediaMutator,
  validateTimeRange,
  type Media,
  type MediaClip,
  type MediaClipInput,
  type TypedPocketBase,
} from '@project/shared';
import { singleMediaType } from './timeline.js';
import type { MediaWithUpload } from './select.js';
import type { OptionGroupOf } from './options.js';

/** MediaClip expanded with its source media (and that media's upload). */
export type MediaClipWithMedia = MediaClip & {
  expand?: { MediaRef?: MediaWithUpload };
};

/** Human-readable label for a clip's source media. */
export function mediaClipMediaLabel(clip: MediaClipWithMedia): string {
  return clip.expand?.MediaRef?.expand?.UploadRef?.name ?? clip.MediaRef;
}

/**
 * Search a workspace's media by its label, description, or source upload
 * filename. Mirrors the webapp's metadata search: the free-text `query` is
 * bound via `pb.filter` to avoid filter-string injection.
 */
export async function searchMedia(
  pb: TypedPocketBase,
  workspaceId: string,
  query: string,
  perPage = 50
): Promise<ListResult<Media>> {
  const filter = pb.filter(
    'WorkspaceRef = {:ws} && (label ~ {:q} || description ~ {:q} || UploadRef.name ~ {:q})',
    { ws: workspaceId, q: query }
  );
  return new MediaMutator(pb).getList(1, perPage, filter);
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

export interface UpdateMediaOptions {
  /** Editor-facing media name (searchable). */
  label?: string;
  /** Editor-facing media notes (searchable). */
  description?: string;
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
} satisfies OptionGroupOf<UpdateMediaOptions>;

/**
 * Patch a media's editor-facing label/description. Only the fields actually
 * passed are written, so an unset flag leaves the stored value untouched.
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

  return mutator.update(mediaId, patch);
}
