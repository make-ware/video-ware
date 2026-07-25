import type { ExpandedMedia, ExpandedMediaClip } from '@/types/expanded-types';
import type { MediaWithPreviews } from '@/services/media';

export type LibrarySurface = 'media-details' | 'timeline';

/**
 * One entry of a tab's sort `<Select>`. Each tab supplies its own descriptors
 * (`MEDIA_SORT_OPTIONS` / `CLIP_SORT_OPTIONS`), which additionally carry the
 * PocketBase sort string and its client comparator; the toolbar only needs
 * what it renders.
 */
export interface LibrarySortChoice {
  value: string;
  label: string;
}

export type LibraryItem =
  | { kind: 'clip'; id: string; clip: ExpandedMediaClip }
  | { kind: 'media'; id: string; media: MediaWithPreviews | ExpandedMedia };

export interface MediaClipDragPayload {
  type: 'media-clip';
  clipId: string;
  mediaId: string;
  start: number;
  end: number;
  clipType: string;
}

export interface MediaFullDragPayload {
  type: 'media-full';
  mediaId: string;
  duration: number;
}

export type LibraryDragPayload = MediaClipDragPayload | MediaFullDragPayload;
