import {
  LABEL_TYPE_META,
  LABEL_TYPE_TO_REF_FIELD,
  LabelType,
  MediaClipLabelMutator,
  TimelineClipMutator,
  TimelineMutator,
  TimelineTrackMutator,
  buildPlaybackTracks,
  clusterOverlappingRanges,
  computeTimelineDuration,
  findActiveClip,
  findRangeGaps,
  type MediaClipLabel,
  type PlacedClip,
  type Timeline,
  type TimelineClip,
  type TimelineTrackRecord,
  type TypedPocketBase,
} from '@project/shared';
import {
  attributedEntitySummaryOf,
  LABEL_TYPE_CONFIG,
  listLabels,
  type AttributedEntity,
  type LabelHit,
  type LabelRecord,
} from './label.js';
import {
  timelineClipLabelHint,
  type TimelineClipExpanded,
} from './timeline-clip.js';
import { resolveTrackRef } from './timeline.js';

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

/** Full timeline picture: tracks (layer ascending) with placed clips. */
export async function getTimelineOverview(
  pb: TypedPocketBase,
  timelineId: string
): Promise<TimelineOverview> {
  const timeline = await new TimelineMutator(pb).getById(timelineId);
  if (!timeline) {
    throw new Error(`Timeline not found: ${timelineId}`);
  }
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
            sourceTime: active.clip.start + (opts.at - active.globalStart),
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

export interface ClipLabelDetail {
  /** Labels the source MediaClip was explicitly created/linked from. */
  provenance: ProvenanceLabel[];
  /** Labels overlapping the clip's source-media window, per type. */
  overlapping: LabelHit[];
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
 * source window. Caption clips have neither. Both carry the attributed
 * Entity when the label has been identified.
 */
export async function clipLabelDetail(
  pb: TypedPocketBase,
  clip: TimelineClipExpanded,
  limitPerType = 10
): Promise<ClipLabelDetail> {
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

  let overlapping: LabelHit[] = [];
  if (clip.MediaRef) {
    const { hits } = await listLabels(pb, {
      mediaId: clip.MediaRef,
      limit: limitPerType,
      window: { start: clip.start, end: clip.end },
    });
    overlapping = hits;
  }

  return { provenance, overlapping };
}
