import {
  MediaClipMutator,
  TimelineClipMutator,
  getCompositeSegments,
  windowCompositeSegments,
  type CompositeSegment,
  type TypedPocketBase,
} from '@project/shared';
import type { EditListSource } from './clip-times.js';
import { resolveTimelineEditList } from './timeline-clip.js';

/**
 * Resolving "what does this clip actually play" for either clip kind.
 *
 * Lives in its own module rather than clip-times.ts because it needs
 * `resolveTimelineEditList` from timeline-clip.ts, which already imports
 * clip-times.ts — putting it there would close an import cycle.
 */

/** Why a media-less timeline clip can't answer, and what to do about it. */
function noSourceMediaReason(clip: {
  CaptionRef?: string;
  SourceTimelineRef?: string;
}): string {
  if (clip.CaptionRef) {
    return 'it is a caption, and rendered text has no labels.';
  }
  if (clip.SourceTimelineRef) {
    return (
      `it plays nested timeline ${clip.SourceTimelineRef} — read labels ` +
      `from the clips inside it (\`vw timeline clips list -t ${clip.SourceTimelineRef}\`).`
    );
  }
  return 'captions and nested timelines have no labels.';
}

/** A clip's played edit list: its media plus the source ranges it shows. */
export interface ClipEditListFilter {
  mediaId: string;
  /** The windowed edit list — the source ranges the clip actually plays. */
  segments: CompositeSegment[];
  source: EditListSource;
}

/**
 * Resolve the played edit list of a MediaClip or TimelineClip: the clip
 * supplies its media and the windowed segments a time must fall in to count
 * as played. Used by `label list --clip/--timeline-clip` (which labels must
 * overlap) and by `vw frame -c` (which a frame time maps through).
 */
export async function clipEditListFilter(
  pb: TypedPocketBase,
  ref: { clip?: string; timelineClip?: string }
): Promise<ClipEditListFilter> {
  if (ref.clip) {
    const clip = await new MediaClipMutator(pb).getById(ref.clip);
    if (!clip) throw new Error(`Media clip not found: ${ref.clip}`);
    const existing = getCompositeSegments(clip);
    const list = existing?.length
      ? existing
      : [{ start: clip.start, end: clip.end }];
    return {
      mediaId: clip.MediaRef,
      segments: windowCompositeSegments(list, clip.start, clip.end),
      source: existing?.length ? 'clipData' : 'trim',
    };
  }
  const clipId = ref.timelineClip;
  if (!clipId) {
    throw new Error('Pass a MediaClip id (--clip) or TimelineClip id.');
  }
  const clip = await new TimelineClipMutator(pb).getById(clipId);
  if (!clip) throw new Error(`Timeline clip not found: ${clipId}`);
  if (!clip.MediaRef) {
    throw new Error(
      `Clip ${clipId} has no source media — ${noSourceMediaReason(clip)}`
    );
  }
  const editList = await resolveTimelineEditList(pb, clip);
  return {
    mediaId: clip.MediaRef,
    segments: windowCompositeSegments(editList.segments, clip.start, clip.end),
    source: editList.source,
  };
}
