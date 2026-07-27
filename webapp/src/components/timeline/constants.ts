/**
 * Two-up on phones, where the timeline library is a full-bleed bottom sheet and
 * a single column showed barely one card per screenful. From `lg` the library
 * is the editor's 420px sidebar, so it drops to one card and goes back to two
 * once `xl` gives it room.
 */
export const CLIP_GRID_CLASS =
  'grid grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3';

/** Shorter thumbnails while two cards share a phone's width. */
export const CLIP_THUMBNAIL_HEIGHT = 'h-24 sm:h-42';
