/**
 * One entry of a clip's edit list: a {start, end} range in source-media
 * seconds. Stored in MediaClip.clipData.segments and (as a copy-on-write
 * override) TimelineClip.meta.segments. A list is only "active" — makes the
 * clip composite — from 2 segments (hasActiveEditList in @project/shared).
 *
 * The interactive editing UI lives in the clip fine-tune modal
 * (components/clip/clip-fine-tune-modal.tsx); the legacy SegmentEditor
 * component that used to live here was unused and has been removed.
 */
export interface Segment {
  start: number;
  end: number;
}
