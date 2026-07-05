/**
 * Track generation utilities for timeline-to-render conversion
 *
 * Generates the tracks array for render tasks from timeline clips.
 */

import type { TimelineTrack, TimelineSegment } from '../types/task-contracts';
import type { TimelineClip } from '../schema/timeline-clip';
import type { MediaClip } from '../schema/media-clip';
import type { Caption } from '../schema/caption';
import {
  isMediaClipComposite,
  getCompositeSegments,
  expandCompositeToSegments,
  calculateEffectiveDuration,
} from './composite-utils';
import {
  clampCuesToWindow,
  cuesFromTranscripts,
  type TranscriptLike,
} from './captions';
import {
  DEFAULT_CAPTION_STYLE,
  type CaptionCue,
  type CaptionStyle,
} from '../types/captions';
import { MAX_NESTED_TIMELINE_DEPTH } from '../enums';
import { projectChildWindow, type NestedTimelineMap } from './nested-timeline';

/**
 * Optional inputs that let generateTracks burn auto-captions into the render.
 *
 * Transcript captions are derived from each media clip's LabelSpeech words
 * (keyed by media id) so the renderer can show them alongside custom Caption
 * clips, without persisting any extra records.
 */
export interface GenerateTracksOptions {
  /** LabelSpeech-like transcript records keyed by media id */
  transcriptsByMedia?: Record<string, TranscriptLike[]>;
  /** When false, no caption text segments are emitted (default true) */
  includeCaptions?: boolean;
  /** Style applied to derived transcript captions (default DEFAULT_CAPTION_STYLE) */
  captionStyle?: CaptionStyle;
  /** Clips + tracks of timelines referenced by nested-timeline clips */
  nestedTimelines?: NestedTimelineMap;
  /** The timeline being flattened; guards against self-reference cycles */
  rootTimelineId?: string;
}
/**
 * Validation result for validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  code: string;
  message: string;
  itemId?: string;
  itemType?: 'timeline' | 'timelineClip' | 'mediaClip' | 'media';
  field?: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Extended TimelineClip type with expanded MediaClipRef
 * Used when the mutator expands the MediaClipRef relation
 */
export type TimelineClipWithExpand = TimelineClip & {
  expand?: Record<string, unknown> & {
    MediaClipRef?: MediaClip;
    CaptionRef?: Caption;
  };
};

import type { TimelineTrackRecord } from '../schema/timeline-track';

/**
 * Result of generating segments from a single clip
 */
interface ClipSegmentResult {
  segments: TimelineSegment[];
  totalDuration: number;
}

/**
 * Effective audio volume for a segment.
 *
 * The single source of truth for the volume rule used everywhere: a muted
 * track is silent, otherwise the track volume (default 1) is scaled by the
 * per-clip gain (0.0–1.0, attenuate-only). When no track settings are supplied
 * (legacy orphan clips) the volume is simply the per-clip gain.
 */
function effectiveVolume(
  trackSettings: { isMuted?: boolean; volume?: number } | undefined,
  clipGain: number
): number {
  if (trackSettings?.isMuted) return 0;
  return (trackSettings?.volume ?? 1) * clipGain;
}

/**
 * Build the audio counterpart of a visual segment.
 *
 * The renderer (compose.executor) only emits audio for tracks of type
 * 'audio', so every audible visual segment needs a paired audio segment on a
 * dedicated audio track. Volume is reused verbatim from the visual segment —
 * generateSegmentsFromClip already folded track volume × per-clip gain into it
 * — so the video and audio sides can never drift apart.
 */
function buildAudioSegment(seg: TimelineSegment): TimelineSegment {
  return {
    id: `${seg.id}-audio`,
    assetId: seg.assetId,
    type: 'audio',
    time: seg.time,
    audio: { volume: seg.audio?.volume ?? 1 },
  };
}

/**
 * Build the audio-track segments mirroring a set of visual segments, skipping
 * text (captions) and any segment without a media asset.
 */
function buildAudioTrackSegments(
  videoSegments: TimelineSegment[]
): TimelineSegment[] {
  return videoSegments
    .filter((seg) => seg.assetId && seg.type !== 'text')
    .map(buildAudioSegment);
}

/**
 * Map a CaptionStyle onto the style fields of a text segment. Shared by custom
 * caption clips and auto-derived transcript captions so both render identically.
 */
function captionStyleToText(style: CaptionStyle) {
  return {
    fontSize: style.fontSize,
    color: style.color,
    backgroundColor: style.backgroundColor,
    backgroundOpacity: style.backgroundOpacity,
    position: style.position,
    align: style.align,
    bold: style.bold,
    shadow: style.shadow,
    shadowColor: style.shadowColor,
    shadowOpacity: style.shadowOpacity,
    outline: style.outline,
    outlineColor: style.outlineColor,
    outlineOpacity: style.outlineOpacity,
  };
}

/**
 * Build the auto-caption text segment for a media clip from its LabelSpeech
 * transcripts, or null when captions are disabled / no transcripts exist.
 *
 * Words live in absolute media time; clamping to [clip.start, clip.end] both
 * trims to the visible source window and re-bases cues to the clip start —
 * mirroring how custom caption clips trim their own cue timeline. The segment
 * is placed at the clip's timeline position so the renderer draws each cue at
 * startTime + cue.start, in lockstep with the video.
 */
function buildTranscriptCaptionSegment(
  clip: TimelineClip,
  startTime: number,
  duration: number,
  options?: GenerateTracksOptions
): TimelineSegment | null {
  if (!options || options.includeCaptions === false) return null;
  if (!clip.MediaRef) return null;

  const transcripts = options.transcriptsByMedia?.[clip.MediaRef];
  if (!transcripts || transcripts.length === 0) return null;

  const cues = clampCuesToWindow(
    cuesFromTranscripts(transcripts),
    clip.start,
    clip.end
  );
  if (cues.length === 0) return null;

  const style = options.captionStyle ?? DEFAULT_CAPTION_STYLE;
  return {
    id: `${clip.id}-captions`,
    type: 'text',
    time: { start: startTime, duration },
    text: { content: '', cues, ...captionStyleToText(style) },
  };
}

/**
 * Generate timeline segments from a single clip
 *
 * Handles both regular clips and composite clips (with segments in clipData).
 * For composite clips, this expands them into multiple segments.
 *
 * @param clip - The timeline clip to process
 * @param startTime - Where on the timeline this clip starts
 * @param trackSettings - Optional video/audio settings from the track
 * @param captionOptions - Optional transcript/caption inputs for auto-captions
 * @returns Array of generated segments and total duration
 */
function generateSegmentsFromClip(
  clip: TimelineClip,
  startTime: number,
  trackSettings?: { opacity?: number; isMuted?: boolean; volume?: number },
  captionOptions?: GenerateTracksOptions
): ClipSegmentResult {
  const clipWithExpand = clip as TimelineClipWithExpand;
  const mediaClip = clipWithExpand.expand?.MediaClipRef;

  // Nested-timeline clips expand into whole tracks, not segments — the track
  // loop diverts them to expandNestedClipToTracks before reaching here. Keep
  // layout stable if one slips through (e.g. legacy orphan path).
  if (clip.SourceTimelineRef) {
    return { segments: [], totalDuration: clip.end - clip.start };
  }

  // Per-clip audio gain (0.0–1.0, attenuate-only). Folded into the track
  // volume so a clip can be quieter than its track without affecting siblings.
  const clipGain = clip.meta?.gain ?? 1;

  // Visual/audio properties shared by every media segment this clip produces.
  // Computing them once keeps the volume rule in a single place
  // (effectiveVolume) no matter which branch below builds the segments.
  const opacity = trackSettings?.opacity;
  const volume = effectiveVolume(trackSettings, clipGain);

  // Caption clips render as text segments (clip.start/end trim the caption's
  // own cue timeline, mirroring how media clips trim source media)
  if (clip.CaptionRef) {
    const caption = clipWithExpand.expand?.CaptionRef;
    const duration = clip.end - clip.start;
    const style = (caption?.style ?? {}) as CaptionStyle;
    const cues = clampCuesToWindow(
      (caption?.cues ?? undefined) as CaptionCue[] | undefined,
      clip.start,
      clip.end
    );

    const segments: TimelineSegment[] = [
      {
        id: clip.id,
        type: 'text',
        time: {
          start: startTime,
          duration,
        },
        text: {
          content: caption?.text ?? clip.meta?.title ?? '',
          cues: cues.length > 0 ? cues : undefined,
          ...captionStyleToText(style),
        },
      },
    ];

    return { segments, totalDuration: duration };
  }

  // Check for TimelineClip-level segments first (override)
  if (clip.meta?.segments && clip.meta.segments.length > 0) {
    const compositeSegments = clip.meta.segments;
    // Calculate effective duration from segments
    const usageSourceStart = 0;
    const usageDuration = calculateEffectiveDuration(
      clip.start,
      clip.end,
      compositeSegments
    );

    const expanded = expandCompositeToSegments(
      compositeSegments,
      usageSourceStart,
      usageDuration,
      startTime
    );

    const segments: TimelineSegment[] = expanded.map((expSeg, i) => ({
      id: `${clip.id}_${i}`,
      assetId: clip.MediaRef,
      type: 'video' as const,
      time: {
        start: expSeg.timelineStart,
        duration: expSeg.duration,
        sourceStart: expSeg.sourceStart,
      },
      video: { opacity },
      audio: { volume },
    }));

    return { segments, totalDuration: usageDuration };
  }

  // Check if this is a composite clip (from MediaClip definition)
  if (isMediaClipComposite(mediaClip)) {
    const compositeSegments = getCompositeSegments(mediaClip);
    if (compositeSegments && compositeSegments.length > 0) {
      // Calculate effective duration from segments
      const usageSourceStart = 0;
      const usageDuration = calculateEffectiveDuration(
        clip.start,
        clip.end,
        compositeSegments
      );

      const expanded = expandCompositeToSegments(
        compositeSegments,
        usageSourceStart,
        usageDuration,
        startTime
      );

      const segments: TimelineSegment[] = expanded.map((expSeg, i) => ({
        id: `${clip.id}_${i}`,
        assetId: mediaClip!.MediaRef,
        type: 'video' as const,
        time: {
          start: expSeg.timelineStart,
          duration: expSeg.duration,
          sourceStart: expSeg.sourceStart,
        },
        video: { opacity },
        audio: { volume },
      }));

      return { segments, totalDuration: usageDuration };
    }
  }

  // Standard clip (non-composite)
  const duration = clip.end - clip.start;

  const isImage = clipWithExpand.expand?.MediaRef?.mediaType === 'image';

  const segments: TimelineSegment[] = [
    {
      id: clip.id,
      assetId: clip.MediaRef,
      type: isImage ? 'image' : 'video',
      time: {
        start: startTime,
        duration: duration,
        sourceStart: clip.start,
      },
      video: { opacity },
      audio: { volume },
    },
  ];

  // Auto-derived single-line captions from this media's LabelSpeech transcripts
  // (composite clips return earlier; their non-linear source→timeline mapping
  // isn't supported yet).
  const captionSegment = buildTranscriptCaptionSegment(
    clip,
    startTime,
    duration,
    captionOptions
  );
  if (captionSegment) segments.push(captionSegment);

  return { segments, totalDuration: duration };
}

/**
 * Generate Tracks from timeline clips
 *
 * Converts TimelineClip records into a multi-track structure suitable for rendering.
 * Currently maps all clips to a single video track (Layer 0).
 * Future updates can separate tracks based on clip metadata (e.g. audio clips, overlay clips).
 *
 * @param timelineClips - Array of TimelineClip records (should be sorted by order)
 * @returns Array of TimelineTrack objects
 */

/**
 * Lay out orphan clips (those without a TimelineTrackRef) sequentially,
 * honoring an explicit timelineStart but never allowing overlap. Used by the
 * legacy/transitional fallback tracks. Per-clip gain is folded into each
 * segment's audio volume by generateSegmentsFromClip.
 */
function buildOrphanSegments(
  clips: TimelineClip[],
  captionOptions?: GenerateTracksOptions
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let currentTimelineTime = 0;

  for (const clip of clips) {
    let startTime =
      typeof clip.timelineStart === 'number'
        ? clip.timelineStart
        : currentTimelineTime;

    // Force sequential placement to prevent overlaps from stale timelineStart
    if (startTime < currentTimelineTime) {
      startTime = currentTimelineTime;
    }

    const result = generateSegmentsFromClip(
      clip,
      startTime,
      undefined,
      captionOptions
    );
    segments.push(...result.segments);
    currentTimelineTime = startTime + result.totalDuration;
  }

  return segments;
}

/**
 * Result of expanding one nested-timeline clip into render tracks.
 */
interface NestedClipTracksResult {
  tracks: TimelineTrack[];
  totalDuration: number;
}

/**
 * Expand a nested-timeline clip into render tracks.
 *
 * The child timeline is flattened with the same generateTracks pipeline
 * (recursively, so nested-in-nested works), then every segment is projected
 * through the clip's trim window [clip.start, clip.end) onto the parent
 * timeline at startTime. Child tracks keep their relative ordering via
 * fractional layers between the parent track's layer and the next integer
 * layer, so the renderer's layer sort composites them exactly where the clip
 * sits in the parent's stack.
 *
 * Unresolvable children (missing data, cycle, depth cap) expand to nothing
 * but still occupy the clip's trimmed duration so sequential layout holds.
 */
function expandNestedClipToTracks(
  clip: TimelineClip,
  startTime: number,
  trackSettings:
    | { opacity?: number; isMuted?: boolean; volume?: number; layer?: number }
    | undefined,
  options: GenerateTracksOptions | undefined,
  depth: number,
  visited: ReadonlySet<string>
): NestedClipTracksResult {
  const totalDuration = clip.end - clip.start;
  const childId = clip.SourceTimelineRef;
  const childData = childId ? options?.nestedTimelines?.[childId] : undefined;
  if (
    !childId ||
    !childData ||
    visited.has(childId) ||
    depth >= MAX_NESTED_TIMELINE_DEPTH
  ) {
    return { tracks: [], totalDuration };
  }

  const childTracks = generateTracksInternal(
    childData.clips,
    childData.tracks,
    options,
    depth + 1,
    new Set([...visited, childId])
  );

  // The whole child composition behaves like one clip on the parent track:
  // parent track volume × the clip's own gain scale every child audio
  // segment (whose volume already folds the child's track/clip levels).
  const clipGain = clip.meta?.gain ?? 1;
  const audioFactor = effectiveVolume(trackSettings, clipGain);
  const parentOpacity = trackSettings?.opacity;
  const parentLayer = trackSettings?.layer ?? 0;

  // Rank child visual tracks by layer for order-preserving fractional layers
  const videoRanks = new Map<string, number>();
  childTracks
    .filter((t) => t.type !== 'audio')
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
    .forEach((t, i) => videoRanks.set(t.id, i));

  const projected: TimelineTrack[] = [];

  for (const childTrack of childTracks) {
    if (childTrack.type === 'audio' && audioFactor === 0) continue;

    const segments: TimelineSegment[] = [];
    for (const seg of childTrack.segments) {
      const window = projectChildWindow(
        startTime,
        clip.start,
        clip.end,
        seg.time.start,
        seg.time.start + seg.time.duration
      );
      if (!window) continue;
      const duration = window.parentEnd - window.parentStart;

      // '_' separator: segment ids become ffmpeg filter link labels, where
      // ':' is unsafe.
      const next: TimelineSegment = {
        ...seg,
        id: `${clip.id}_${seg.id}`,
        time: {
          start: window.parentStart,
          duration,
          ...(seg.time.sourceStart !== undefined
            ? { sourceStart: seg.time.sourceStart + window.headTrim }
            : {}),
        },
      };

      if (seg.audio) {
        next.audio = {
          ...seg.audio,
          volume: (seg.audio.volume ?? 1) * audioFactor,
        };
      }
      if (
        seg.video &&
        (seg.video.opacity !== undefined || parentOpacity !== undefined)
      ) {
        next.video = {
          ...seg.video,
          opacity: (seg.video.opacity ?? 1) * (parentOpacity ?? 1),
        };
      }
      // Cues are relative to the segment start; head-trimming the segment
      // shifts and clips them the same way caption clips trim their cues.
      if (seg.type === 'text' && seg.text?.cues && seg.text.cues.length > 0) {
        next.text = {
          ...seg.text,
          cues: clampCuesToWindow(
            seg.text.cues,
            window.headTrim,
            window.headTrim + duration
          ),
        };
      }
      segments.push(next);
    }
    if (segments.length === 0) continue;

    const rank = videoRanks.get(childTrack.id) ?? 0;
    projected.push({
      id: `${clip.id}_${childTrack.id}`,
      type: childTrack.type,
      layer: parentLayer + (rank + 1) / 64,
      segments,
    });
  }

  return { tracks: projected, totalDuration };
}

/**
 * Generate Tracks from timeline clips and track definitions
 *
 * Converts TimelineClip records into a multi-track structure suitable for rendering.
 *
 * @param timelineClips - Array of TimelineClip records
 * @param timelineTracks - Optional array of TimelineTrackEntity records. If not provided, assumes single track.
 * @returns Array of TimelineTrack objects (Worker format)
 */
export function generateTracks(
  timelineClips: TimelineClip[],
  timelineTracks: TimelineTrackRecord[] = [],
  options?: GenerateTracksOptions
): TimelineTrack[] {
  return generateTracksInternal(
    timelineClips,
    timelineTracks,
    options,
    0,
    new Set(options?.rootTimelineId ? [options.rootTimelineId] : [])
  );
}

function generateTracksInternal(
  timelineClips: TimelineClip[],
  timelineTracks: TimelineTrackRecord[] = [],
  options: GenerateTracksOptions | undefined,
  depth: number,
  visited: ReadonlySet<string>
): TimelineTrack[] {
  // Map standard tracks from entities to worker format
  const tracks: TimelineTrack[] = [];

  // Tracks produced by expanding nested-timeline clips (fractional layers)
  const nestedTracks: TimelineTrack[] = [];

  // Group clips by TimelineTrackRef
  const clipsByTrack = new Map<string, TimelineClip[]>();
  const clipsWithoutTrack: TimelineClip[] = [];

  for (const clip of timelineClips) {
    if (clip.TimelineTrackRef) {
      const trackClips = clipsByTrack.get(clip.TimelineTrackRef) || [];
      trackClips.push(clip);
      clipsByTrack.set(clip.TimelineTrackRef, trackClips);
    } else {
      clipsWithoutTrack.push(clip);
    }
  }

  // Process defined tracks
  for (const trackEntity of timelineTracks) {
    const trackClips = clipsByTrack.get(trackEntity.id ?? '') || [];

    // Sort clips: prioritized by timelineStart, then order (for legacy/mixed support)
    trackClips.sort((a, b) => {
      if (
        typeof a.timelineStart === 'number' &&
        typeof b.timelineStart === 'number'
      ) {
        return a.timelineStart - b.timelineStart;
      }
      return a.order - b.order;
    });

    const segments: TimelineSegment[] = [];
    let currentTimelineTime = 0;

    for (const clip of trackClips) {
      // Determine start time: use timelineStart if available, otherwise append sequentially
      let startTime =
        typeof clip.timelineStart === 'number'
          ? clip.timelineStart
          : currentTimelineTime;

      // Force sequential placement on Layer 0 (Primary Storyline) to prevent overlaps
      // caused by incorrect timelineStart values (e.g., 0)
      if (trackEntity.layer === 0 && startTime < currentTimelineTime) {
        startTime = currentTimelineTime;
      }

      // Nested-timeline clips expand into their own render tracks
      if (clip.SourceTimelineRef) {
        const nestedResult = expandNestedClipToTracks(
          clip,
          startTime,
          {
            opacity: trackEntity.opacity,
            isMuted: trackEntity.isMuted,
            volume: trackEntity.volume,
            layer: trackEntity.layer,
          },
          options,
          depth,
          visited
        );
        nestedTracks.push(...nestedResult.tracks);
        currentTimelineTime = startTime + nestedResult.totalDuration;
        continue;
      }

      // Generate segments (handles both regular and composite clips)
      const result = generateSegmentsFromClip(
        clip,
        startTime,
        {
          opacity: trackEntity.opacity,
          isMuted: trackEntity.isMuted,
          volume: trackEntity.volume,
        },
        options
      );

      segments.push(...result.segments);
      currentTimelineTime = startTime + result.totalDuration;
    }

    tracks.push({
      id: trackEntity.id ?? `track-${trackEntity.layer}`,
      type: 'video', // Main track type
      layer: trackEntity.layer,
      segments,
    });
  }

  // Handle clips without a TimelineTrackRef (legacy/transitional timelines).
  // In a clean state every clip has a track, so this is a fallback path.
  if (clipsWithoutTrack.length > 0) {
    clipsWithoutTrack.sort((a, b) => a.order - b.order);
    const orphanSegments = buildOrphanSegments(clipsWithoutTrack, options);

    // existingLayer0 truthy implies tracks.length >= 1, so the two cases are:
    //   - defined tracks already own layer 0 → park orphans on a high layer so
    //     they can't clobber the primary storyline (diagnostic only, no audio).
    //   - no layer 0 yet → synthesize the default video + audio track pair,
    //     reusing the same audio builder as every other track.
    const existingLayer0 = tracks.find((t) => t.layer === 0);

    if (existingLayer0) {
      tracks.push({
        id: 'orphan-clips-track',
        type: 'video',
        layer: 999,
        segments: orphanSegments,
      });
    } else {
      tracks.push({
        id: 'default-video-track',
        type: 'video',
        layer: 0,
        segments: orphanSegments,
      });
      tracks.push({
        id: 'default-audio-track',
        type: 'audio',
        layer: 0,
        segments: buildAudioTrackSegments(orphanSegments),
      });
    }
  }

  // The renderer (compose.executor) only emits audio for tracks of type
  // 'audio' — it never extracts audio from visual tracks. So each defined
  // track needs a paired audio track carrying the audio component of its
  // clips. buildAudioTrackSegments reuses the per-segment volume already
  // computed by generateSegmentsFromClip (track volume × per-clip gain).
  const audioTracks: TimelineTrack[] = [];

  for (const trackEntity of timelineTracks) {
    if (trackEntity.isMuted) continue;

    // Find the corresponding video track we just created
    const vidTrack = tracks.find((t) => t.id === trackEntity.id);
    if (!vidTrack) continue;

    audioTracks.push({
      id: `${trackEntity.id}-audio`,
      type: 'audio',
      layer: trackEntity.layer,
      segments: buildAudioTrackSegments(vidTrack.segments),
    });
  }

  // Nested tracks carry their own audio tracks (projected from the child
  // timeline's), so they are appended as-is rather than paired above.
  return [...tracks, ...audioTracks, ...nestedTracks];
}

/**
 * Validate a TimeOffset object
 *
 * @param offset - TimeOffset to validate
 * @param context - Context string for error messages
 * @param field - Field name for error messages
 * @returns Array of validation errors (empty if valid)
 */
export function validateTimeOffset(
  offset: unknown,
  context: string,
  field: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!offset || typeof offset !== 'object') {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field}`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Type guard: check if offset has required properties
  if (!('seconds' in offset) || !('nanos' in offset)) {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field} (missing required properties)`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Validate seconds
  if (typeof offset.seconds !== 'number') {
    errors.push({
      code: 'INVALID_SECONDS_TYPE',
      message: `${context} ${field}.seconds is not a number`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (!Number.isInteger(offset.seconds)) {
    errors.push({
      code: 'INVALID_SECONDS_INTEGER',
      message: `${context} ${field}.seconds is not an integer`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (offset.seconds < 0) {
    errors.push({
      code: 'INVALID_SECONDS_NEGATIVE',
      message: `${context} ${field}.seconds is negative`,
      field: `${field}.seconds`,
      expected: '>= 0',
      actual: offset.seconds,
    });
  }

  // Validate nanos
  if (typeof offset.nanos !== 'number') {
    errors.push({
      code: 'INVALID_NANOS_TYPE',
      message: `${context} ${field}.nanos is not a number`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (!Number.isInteger(offset.nanos)) {
    errors.push({
      code: 'INVALID_NANOS_INTEGER',
      message: `${context} ${field}.nanos is not an integer`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (offset.nanos < 0 || offset.nanos > 999_999_999) {
    errors.push({
      code: 'INVALID_NANOS_RANGE',
      message: `${context} ${field}.nanos is out of range [0, 999999999]`,
      field: `${field}.nanos`,
      expected: '[0, 999999999]',
      actual: offset.nanos,
    });
  }

  return errors;
}
