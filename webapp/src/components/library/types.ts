import type { ExpandedMedia, ExpandedMediaClip } from '@/types/expanded-types';
import type { MediaWithPreviews } from '@/services/media';

export type LibrarySurface = 'media-details' | 'timeline';

export type LibrarySortBy = 'recent' | 'duration' | 'name' | 'media_time';

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
