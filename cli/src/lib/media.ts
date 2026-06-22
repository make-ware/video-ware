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

/** MediaClip expanded with its source media (and that media's upload). */
export type MediaClipWithMedia = MediaClip & {
  expand?: { MediaRef?: MediaWithUpload };
};

/** Human-readable label for a clip's source media. */
export function mediaClipMediaLabel(clip: MediaClipWithMedia): string {
  return clip.expand?.MediaRef?.expand?.UploadRef?.name ?? clip.MediaRef;
}

/**
 * Search a workspace's media by its source upload filename. Mirrors the
 * webapp's metadata search: the free-text `query` is bound via `pb.filter`
 * to avoid filter-string injection.
 */
export async function searchMediaByName(
  pb: TypedPocketBase,
  workspaceId: string,
  query: string,
  perPage = 50
): Promise<ListResult<Media>> {
  const filter = pb.filter('WorkspaceRef = {:ws} && UploadRef.name ~ {:q}', {
    ws: workspaceId,
    q: query,
  });
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
  /** Workspace id. Defaults to the source media's workspace. */
  workspaceId?: string;
}

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
    start,
    end,
    duration: end - start,
    version: 1,
  };

  return new MediaClipMutator(pb).create(input);
}
