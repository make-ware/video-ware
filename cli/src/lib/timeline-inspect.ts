import {
  LABEL_TYPE_META,
  LABEL_TYPE_TO_REF_FIELD,
  LabelType,
  MediaClipLabelMutator,
  MediaMutator,
  TIMELINE_EPSILON,
  TimelineClipMutator,
  TimelineMutator,
  TimelineTrackMutator,
  buildPlaybackTracks,
  clipOffsetAtSourceTime,
  clipSourceTimeAtOffset,
  clusterOverlappingRanges,
  compositeOffsetAtSourceTime,
  computeTimelineDuration,
  findActiveClip,
  findRangeGaps,
  normalizeSegments,
  roundToMs,
  windowCompositeSegments,
  type CompositeSegment,
  type MediaClipLabel,
  type PlacedClip,
  type Timeline,
  type TimelineClip,
  type TimelineTrackRecord,
  type TypedPocketBase,
} from '@project/shared';
import { assertWorkspaceMatch } from './workspace-option.js';
import {
  attributedEntitySummaryOf,
  LABEL_TYPE_CONFIG,
  listLabels,
  type AttributedEntity,
  type LabelHit,
  type LabelRecord,
} from './label.js';
import {
  assertOnTimeline,
  resolveClipLane,
  resolveTimelineEditList,
  timelineClipLabelHint,
  type TimelineClipExpanded,
} from './timeline-clip.js';
import { timelineClipTimes, type ClipTimes } from './clip-times.js';
import { mediaBounds, resolveTrackRef } from './timeline.js';

/**
 * Timeline inspection for the CLI: resolve clips to their computed timeline
 * positions (`timeline show`) and answer "what plays at time T on each
 * track" (`timeline inspect`), with label hints and optional label detail.
 */

export interface InspectClipInfo {
  clip: TimelineClipExpanded;
  /** Computed position on the timeline (seconds). */
  timelineStart: number;
  timelineEnd: number;
  labelHint: string;
  kind: 'media' | 'caption' | 'timeline';
  /** Canonical time semantics (timeline/source/effective + edit-list summary). */
  times: ClipTimes;
}

export interface TrackOverview {
  /** Null for the implicit lane holding clips of a track-less legacy timeline. */
  track: TimelineTrackRecord | null;
  layer: number;
  clips: InspectClipInfo[];
}

export interface TimelineOverview {
  timeline: Timeline;
  /** Accurate duration (furthest clip end), vs. the stored timeline.duration. */
  computedDuration: number;
  clipCount: number;
  tracks: TrackOverview[];
  /** Raw records backing the placed view, so callers (reflow) skip re-fetching. */
  clips: TimelineClip[];
  trackRecords: TimelineTrackRecord[];
}

function toClipInfo(placed: PlacedClip): InspectClipInfo {
  const clip = placed.clip as TimelineClipExpanded;
  return {
    clip,
    timelineStart: placed.globalStart,
    timelineEnd: placed.globalEnd,
    labelHint: timelineClipLabelHint(clip),
    kind: clip.CaptionRef
      ? 'caption'
      : clip.SourceTimelineRef
        ? 'timeline'
        : 'media',
    times: timelineClipTimes(clip, {
      timelineStart: placed.globalStart,
      timelineEnd: placed.globalEnd,
    }),
  };
}

function placedClipsOf(track: {
  mediaClips: PlacedClip[];
  captionClips: PlacedClip[];
  timelineClips: PlacedClip[];
}): PlacedClip[] {
  return [
    ...track.mediaClips,
    ...track.captionClips,
    ...track.timelineClips,
  ].sort((a, b) => a.globalStart - b.globalStart);
}

/**
 * Full timeline picture: tracks (layer ascending) with placed clips. The single
 * choke point for every timeline/clip command, so a `-w` that contradicts the
 * timeline is caught here rather than in each command.
 */
export async function getTimelineOverview(
  pb: TypedPocketBase,
  timelineId: string
): Promise<TimelineOverview> {
  const timeline = await new TimelineMutator(pb).getById(timelineId);
  if (!timeline) {
    throw new Error(`Timeline not found: ${timelineId}`);
  }
  await assertWorkspaceMatch(
    pb,
    timeline.WorkspaceRef,
    `Timeline ${timelineId}`
  );
  const clips = await new TimelineClipMutator(pb).getByTimeline(timelineId);
  const trackRecords = (
    await new TimelineTrackMutator(pb).getByTimeline(timelineId)
  ).items;

  const byId = new Map(trackRecords.map((t) => [t.id, t]));
  const tracks = buildPlaybackTracks(clips, trackRecords).map((pt) => ({
    track: pt.trackId ? (byId.get(pt.trackId) ?? null) : null,
    layer: pt.layer,
    clips: placedClipsOf(pt).map(toClipInfo),
  }));

  return {
    timeline,
    computedDuration: computeTimelineDuration(clips, trackRecords),
    clipCount: clips.length,
    tracks,
    clips,
    trackRecords,
  };
}

const inspectRange = (clip: InspectClipInfo) => ({
  start: clip.timelineStart,
  end: clip.timelineEnd,
});

/**
 * Groups of same-track clips whose computed ranges overlap. Same-track
 * overlap violates the data model (it usually means positions collapsed to
 * 0s in legacy records) — `timeline show` warns on it and `timeline doctor`
 * reports it as an error.
 */
export function overlapClusters(clips: InspectClipInfo[]): InspectClipInfo[][] {
  return clusterOverlappingRanges(clips, inspectRange);
}

/** A silent span between two consecutive clips on a track. */
export interface TrackGap {
  start: number;
  end: number;
  beforeClipId: string;
  afterClipId: string;
}

/** Gaps between consecutive placed clips on one track (not before the first). */
export function trackGaps(clips: InspectClipInfo[]): TrackGap[] {
  return findRangeGaps(clips, inspectRange).map((gap) => ({
    start: gap.start,
    end: gap.end,
    beforeClipId: gap.before.clip.id,
    afterClipId: gap.after.clip.id,
  }));
}

export interface ActiveClipInfo extends InspectClipInfo {
  /** Position within the source media at the inspected time (seconds). */
  sourceTime: number;
  /** Time left before this clip ends (seconds). */
  remaining: number;
}

export interface TrackAtTime {
  layer: number;
  trackId: string | null;
  trackName: string;
  volume: number;
  opacity: number;
  isMuted: boolean;
  isLocked: boolean;
  /** The clip playing at the inspected time, or null when the track is idle. */
  active: ActiveClipInfo | null;
  /** Start of the next clip after the inspected time, if any. */
  nextStart: number | null;
}

export interface InspectAtTimeOptions {
  timelineId: string;
  /** Timeline time to inspect (seconds). */
  at: number;
  /** Restrict to one track: layer number or record id. */
  track?: string;
}

export interface InspectAtTimeResult {
  at: number;
  computedDuration: number;
  tracks: TrackAtTime[];
}

/** What plays on each track (or one track) at a timeline time. */
export async function inspectAtTime(
  pb: TypedPocketBase,
  opts: InspectAtTimeOptions
): Promise<InspectAtTimeResult> {
  const timeline = await new TimelineMutator(pb).getById(opts.timelineId);
  if (!timeline) {
    throw new Error(`Timeline not found: ${opts.timelineId}`);
  }
  await assertWorkspaceMatch(
    pb,
    timeline.WorkspaceRef,
    `Timeline ${opts.timelineId}`
  );
  const clips = await new TimelineClipMutator(pb).getByTimeline(
    opts.timelineId
  );
  const trackRecords = (
    await new TimelineTrackMutator(pb).getByTimeline(opts.timelineId)
  ).items;

  let playback = buildPlaybackTracks(clips, trackRecords);
  if (opts.track) {
    const target = await resolveTrackRef(pb, opts.timelineId, opts.track);
    playback = playback.filter((pt) => pt.trackId === target.id);
  }

  const byId = new Map(trackRecords.map((t) => [t.id, t]));
  const tracks: TrackAtTime[] = playback.map((pt) => {
    const placed = placedClipsOf(pt);
    const active = findActiveClip(placed, opts.at);
    const next = placed.find((p) => p.globalStart > opts.at);
    const record = pt.trackId ? byId.get(pt.trackId) : undefined;

    return {
      layer: pt.layer,
      trackId: pt.trackId,
      trackName: record?.name ?? '(implicit)',
      volume: pt.volume,
      opacity: pt.opacity,
      isMuted: pt.isMuted,
      isLocked: record?.isLocked ?? false,
      active: active
        ? {
            ...toClipInfo(active),
            // Mapped through the clip's windowed edit list — a composite
            // reports the source time actually playing, never a gap time.
            sourceTime: clipSourceTimeAtOffset(
              active.clip,
              opts.at - active.globalStart
            ),
            remaining: active.globalEnd - opts.at,
          }
        : null,
      nextStart: next ? next.globalStart : null,
    };
  });

  return {
    at: opts.at,
    computedDuration: computeTimelineDuration(clips, trackRecords),
    tracks,
  };
}

/** Which time domain a `clips map` input value is expressed in. */
export type MapDomain = 'source' | 'timeline' | 'offset';

export interface MapPoint {
  /** Absolute timeline seconds. */
  timeline: number;
  /** Clip-effective seconds (0 = the clip's first visible frame). */
  offset: number;
  /** Source-media seconds actually playing at this point. */
  source: number;
  /** Edit-list segment containing `source` (IDX matches `segments`); null for plain clips. */
  segment: { index: number; start: number; end: number } | null;
}

export interface MapClipTimeResult {
  clipId: string;
  timelineId: string;
  layer: number;
  input: { domain: MapDomain; value: number };
  /** The one played moment expressed in all three domains. */
  point: MapPoint;
  /** Source-time input only: the value sits inside a cut gap (not played). */
  inGap: boolean;
  /** The surrounding cut gap in source seconds, when `inGap`. */
  gap?: { start: number; end: number };
  /** The input fell outside the clip's played content and was clamped. */
  clamped: boolean;
  composite: boolean;
  times: ClipTimes;
}

/**
 * Translate a time through a placed clip's edit list: source-media time ↔
 * clip-effective offset ↔ absolute timeline time. Source times inside a cut
 * gap collapse to the boundary the playhead skips to (reported via
 * `inGap`/`gap`); inputs outside the played content clamp to the nearest
 * edge (`clamped`). Media-backed clips only.
 */
export async function mapClipTime(
  pb: TypedPocketBase,
  clipId: string,
  input: { domain: MapDomain; value: number; timelineId?: string }
): Promise<MapClipTimeResult> {
  const clip = await new TimelineClipMutator(pb).getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, input.timelineId);
  if (!clip.MediaRef) {
    throw new Error(
      `Clip ${clipId} has no source media — time mapping applies to ` +
        `media-backed clips, not captions or nested timelines.`
    );
  }
  const media = await new MediaMutator(pb).getById(clip.MediaRef);
  if (!media) {
    throw new Error(`Media not found for clip ${clipId}: ${clip.MediaRef}`);
  }
  // The full normalized edit list — the same list (and IDX numbering) that
  // `vw … segments` prints, independent of the clip's trim window.
  const editList = await resolveTimelineEditList(pb, clip);
  const segments = normalizeSegments(editList.segments, mediaBounds(media));

  const { track, entries } = await resolveClipLane(pb, clip);
  const entry = entries.find((e) => e.clip.id === clipId);
  if (!entry) {
    throw new Error(`Clip ${clipId} is not placed on its timeline's tracks.`);
  }
  const placement = {
    timelineStart: entry.range.start,
    timelineEnd: entry.range.end,
  };
  const times = timelineClipTimes(clip, placement);
  const effective = times.effective.duration;

  let offset: number;
  let clamped = false;
  let inGap = false;
  let gap: { start: number; end: number } | undefined;

  if (input.domain === 'source') {
    offset = clipOffsetAtSourceTime(clip, input.value);
    for (let i = 0; i < segments.length - 1; i++) {
      if (
        input.value > segments[i].end &&
        input.value < segments[i + 1].start
      ) {
        inGap = true;
        gap = { start: segments[i].end, end: segments[i + 1].start };
        break;
      }
    }
  } else {
    const rawOffset =
      input.domain === 'timeline'
        ? input.value - placement.timelineStart
        : input.value;
    offset = Math.min(Math.max(0, rawOffset), effective);
    clamped = Math.abs(offset - rawOffset) > TIMELINE_EPSILON;
  }

  const source = clipSourceTimeAtOffset(clip, offset);
  if (input.domain === 'source' && !inGap) {
    // A collapse without a gap means the input fell outside the played
    // content (before/after the window, or in a window-trimmed stretch).
    clamped = Math.abs(source - input.value) > TIMELINE_EPSILON;
  }

  const segIndex =
    editList.source === 'trim'
      ? -1
      : segments.findIndex(
          (s: CompositeSegment) =>
            source >= s.start - TIMELINE_EPSILON &&
            source <= s.end + TIMELINE_EPSILON
        );

  return {
    clipId,
    timelineId: clip.TimelineRef,
    layer: track.layer,
    input,
    point: {
      timeline: roundToMs(placement.timelineStart + offset),
      offset: roundToMs(offset),
      source: roundToMs(source),
      segment:
        segIndex >= 0
          ? {
              index: segIndex,
              start: segments[segIndex].start,
              end: segments[segIndex].end,
            }
          : null,
    },
    inGap,
    ...(gap ? { gap } : {}),
    clamped,
    composite: times.composite,
    times,
  };
}

/** A MediaClipLabels provenance row resolved for display. */
export interface ProvenanceLabel {
  type: LabelType;
  labelId: string;
  confidence?: number;
  snippet: string;
  /** Identity context; present only when the label resolves to an Entity. */
  attributedEntity?: AttributedEntity;
  /** The raw join row (Label*Ref expanded). */
  link: MediaClipLabel;
}

/** One stretch of a label the cut actually plays, in all applicable domains. */
export interface PlayedRange {
  /** Label ∩ segment (source seconds). */
  sourceStart: number;
  sourceEnd: number;
  /** Clip-effective offsets. */
  clipStart: number;
  clipEnd: number;
  /** Absolute timeline seconds, when the placement is known. */
  timelineStart?: number;
  timelineEnd?: number;
}

/** An overlapping label annotated with the portions the cut plays. */
export interface OverlappingLabel extends LabelHit {
  played: PlayedRange[];
}

export interface ClipLabelDetail {
  /** Labels the source MediaClip was explicitly created/linked from. */
  provenance: ProvenanceLabel[];
  /**
   * Labels overlapping the clip's PLAYED content — strictly "what plays":
   * labels sitting wholly inside cut gaps are dropped (see hiddenInCutGaps).
   */
  overlapping: OverlappingLabel[];
  /** Labels dropped because they sit entirely inside cut gaps. */
  hiddenInCutGaps: number;
}

export interface ClipLabelDetailOptions {
  /** Max overlapping labels fetched per type (pre-intersection). */
  limitPerType?: number;
  /** The clip's computed timeline position, to project played ranges. */
  placement?: { timelineStart: number };
}

type ExpandedLink = MediaClipLabel & {
  expand?: Partial<Record<string, LabelRecord>>;
};

/**
 * getByClip expand paths: each Label*Ref plus, through it, the entity link
 * points that resolve the label's attributed Entity (skipping LabelTrackRef
 * on the collections that don't have it).
 */
function provenanceExpands(): string[] {
  return Object.values(LabelType).flatMap((type) => {
    const ref = LABEL_TYPE_TO_REF_FIELD[type];
    return [
      ref,
      `${ref}.LabelEntityRef.EntityRef`,
      ...(LABEL_TYPE_META[type].hasTrack
        ? [`${ref}.LabelTrackRef.EntityRef`]
        : []),
    ];
  });
}

/**
 * Label context for a timeline clip: explicit MediaClipLabels provenance
 * (when the clip came from a MediaClip) plus labels overlapping the clip's
 * PLAYED content. The PB query windows by the outer [start, end] span (the
 * correct coarse filter), then hits are intersected with the clip's windowed
 * edit list in memory — a label lying wholly inside a cut gap is dropped and
 * counted, and survivors carry `played` projections into clip/timeline time.
 * Note `limitPerType` applies before the intersection, so a heavily-labeled
 * composite can show fewer than the limit. Caption/nested clips have
 * neither. Provenance rows are lineage, never intersected.
 */
export async function clipLabelDetail(
  pb: TypedPocketBase,
  clip: TimelineClipExpanded,
  opts: ClipLabelDetailOptions = {}
): Promise<ClipLabelDetail> {
  const limitPerType = opts.limitPerType ?? 10;
  const provenance: ProvenanceLabel[] = [];
  if (clip.MediaClipRef) {
    const links = await new MediaClipLabelMutator(pb).getByClip(
      clip.MediaClipRef,
      undefined,
      undefined,
      provenanceExpands()
    );
    for (const link of links.items as ExpandedLink[]) {
      const type = link.labelType as LabelType;
      const refField = LABEL_TYPE_TO_REF_FIELD[type];
      const labelId = (link as unknown as Record<string, string>)[refField];
      const labelRecord = link.expand?.[refField];
      const attributedEntity = labelRecord
        ? attributedEntitySummaryOf(labelRecord)
        : null;
      provenance.push({
        type,
        labelId,
        confidence: link.confidence,
        snippet: labelRecord
          ? LABEL_TYPE_CONFIG[type].snippet(labelRecord)
          : '',
        ...(attributedEntity ? { attributedEntity } : {}),
        link,
      });
    }
  }

  const overlapping: OverlappingLabel[] = [];
  let hiddenInCutGaps = 0;
  if (clip.MediaRef) {
    const { hits } = await listLabels(pb, {
      mediaId: clip.MediaRef,
      limit: limitPerType,
      window: { start: clip.start, end: clip.end },
    });
    const editList = await resolveTimelineEditList(pb, clip);
    const windowed = [
      ...windowCompositeSegments(editList.segments, clip.start, clip.end),
    ].sort((a, b) => a.start - b.start);
    const placedStart = opts.placement?.timelineStart;

    for (const hit of hits) {
      const record = hit.record;
      const played: PlayedRange[] = windowed
        .filter((s) => record.end > s.start && record.start < s.end)
        .map((s) => {
          const sourceStart = Math.max(record.start, s.start);
          const sourceEnd = Math.min(record.end, s.end);
          const clipStart = roundToMs(
            compositeOffsetAtSourceTime(windowed, sourceStart)
          );
          const clipEnd = roundToMs(
            compositeOffsetAtSourceTime(windowed, sourceEnd)
          );
          return {
            sourceStart: roundToMs(sourceStart),
            sourceEnd: roundToMs(sourceEnd),
            clipStart,
            clipEnd,
            ...(placedStart !== undefined
              ? {
                  timelineStart: roundToMs(placedStart + clipStart),
                  timelineEnd: roundToMs(placedStart + clipEnd),
                }
              : {}),
          };
        });
      if (played.length === 0) {
        hiddenInCutGaps++;
        continue;
      }
      overlapping.push({ ...hit, played });
    }
  }

  return { provenance, overlapping, hiddenInCutGaps };
}
