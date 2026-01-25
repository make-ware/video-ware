import type {
  Media,
  MediaClip,
  TimelineClip,
  TimelineRecommendation,
  Upload,
  File,
} from '@project/shared';

// Expanded Media
// Note: We redefine expand here because PocketBase types don't include it by default
// and we know what relations we are expanding in our queries.
export interface ExpandedMedia extends Omit<Media, 'expand'> {
  expand?: {
    UploadRef?: Upload;
    spriteFileRef?: File;
    filmstripFileRefs?: File[];
  };
}

// Expanded MediaClip
export interface ExpandedMediaClip extends Omit<MediaClip, 'expand'> {
  expand?: {
    MediaRef?: ExpandedMedia;
  };
}

// Expanded TimelineClip
export interface ExpandedTimelineClip extends Omit<TimelineClip, 'expand'> {
  expand?: {
    MediaRef?: ExpandedMedia;
    MediaClipRef?: ExpandedMediaClip;
  };
}

// Expanded TimelineRecommendation
export interface ExpandedTimelineRecommendation
  extends Omit<TimelineRecommendation, 'expand'> {
  expand?: {
    MediaClipRef?: ExpandedMediaClip;
    TimelineClipsRef?: ExpandedTimelineClip[];
  };
}
