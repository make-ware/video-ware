import {
  LabelType,
  MediaMutator,
  TimelineClipMutator,
  attributionExpands,
  buildClipTranscript,
  getCompositeSegments,
  normalizeSegments,
  roundToMs,
  speakerTranscriptLabel,
  windowCompositeSegments,
  type ClipTranscript,
  type ClipUtterance,
  type CompositeSegment,
  type TranscriptPart,
  type TypedPocketBase,
  type UtteranceLike,
} from '@project/shared';
import { requireMediaClip } from './select.js';
import {
  attributedEntitySummaryOf,
  labelMutator,
  type AttributedEntity,
  type LabelRecord,
} from './label.js';
import {
  assertOnTimeline,
  resolveClipLane,
  resolveTimelineEditList,
} from './timeline-clip.js';
import {
  mediaClipTimes,
  timelineClipTimes,
  type ClipTimes,
  type EditListSource,
} from './clip-times.js';
import { mediaBounds } from './timeline.js';

/**
 * Per-clip transcripts, trimmed to the clip's WINDOWED edit list at word
 * level — the text an agent reads is the text the cut plays. Speaker labels
 * (ElevenLabs diarized — usually the better transcription) are preferred;
 * speech labels (Google) are the fallback. Shared by `vw media clip
 * transcript` and `vw timeline clips transcript`.
 */

export type TranscriptLabelType = 'speaker' | 'speech';

export interface TranscriptOptions {
  /** Force the label source; default: speaker when rows exist, else speech. */
  type?: TranscriptLabelType;
  /** Include per-word timing arrays in the result (large; default false). */
  words?: boolean;
  /** Timeline variant only: timeline the clip is expected to live on. */
  timelineId?: string;
}

export interface SpeakerInfo {
  /** Provider speaker id ("speaker_0"), speaker labels only. */
  speakerId?: string;
  /** Display label — "Speaker 1 (Erik)" once the speaker is identified. */
  label: string;
  entity?: AttributedEntity;
}

export interface TranscriptPartView extends Omit<TranscriptPart, 'words'> {
  words?: TranscriptPart['words'];
  /** Absolute timeline seconds (timeline clips only). */
  timelineStart?: number;
  timelineEnd?: number;
}

export interface TranscriptUtteranceView extends Omit<ClipUtterance, 'parts'> {
  parts: TranscriptPartView[];
  speaker?: SpeakerInfo;
  /** Absolute timeline seconds (timeline clips only). */
  timelineStart?: number;
  timelineEnd?: number;
}

export interface ClipTranscriptResult {
  clipId: string;
  domain: 'mediaClip' | 'timelineClip';
  mediaId: string;
  /** Which label collection the text came from; null when neither has rows. */
  labelType: TranscriptLabelType | null;
  labelTypeSelected: 'auto' | 'forced';
  /** Same vocabulary as the `segments` command's source field. */
  editListSource: EditListSource;
  /** The windowed edit list the transcript was trimmed to (what plays). */
  segments: CompositeSegment[];
  gaps: Array<{ afterIndex: number; seconds: number }>;
  /** Canonical clip time semantics — same shape as `clips show`. */
  times: ClipTimes;
  /** Timeline clips only. */
  placement?: {
    timelineId: string;
    layer: number;
    timelineStart: number;
    timelineEnd: number;
  };
  utterances: TranscriptUtteranceView[];
  totals: ClipTranscript['totals'];
  /** Flowing speaker-labeled text with [cut Ns] markers — the audit surface. */
  text: string;
}

/** Gaps between consecutive windowed segments (source seconds). */
function segmentGapsOf(
  segments: CompositeSegment[]
): Array<{ afterIndex: number; seconds: number }> {
  const gaps: Array<{ afterIndex: number; seconds: number }> = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const gap = roundToMs(segments[i + 1].start - segments[i].end);
    if (gap > 0) gaps.push({ afterIndex: i, seconds: gap });
  }
  return gaps;
}

/** All utterance rows of one label type overlapping the window, paged. */
async function fetchUtterances(
  pb: TypedPocketBase,
  type: LabelType.SPEAKER | LabelType.SPEECH,
  mediaId: string,
  window: { start: number; end: number }
): Promise<LabelRecord[]> {
  const mutator = labelMutator(pb, type);
  const filter = pb.filter(
    'MediaRef = {:media} && start < {:wEnd} && end > {:wStart}',
    { media: mediaId, wEnd: window.end, wStart: window.start }
  );
  const rows: LabelRecord[] = [];
  let page = 1;
  for (;;) {
    const result = await mutator.getList(
      page,
      200,
      filter,
      'start',
      attributionExpands(type)
    );
    rows.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) break;
    page++;
  }
  return rows;
}

/** Speaker context for one utterance row, per label type. */
function speakerOf(
  record: LabelRecord,
  labelType: TranscriptLabelType
): SpeakerInfo | undefined {
  const fields = record as unknown as Record<string, unknown>;
  const entity = attributedEntitySummaryOf(record) ?? undefined;
  if (labelType === 'speaker') {
    const speakerId =
      typeof fields.speakerId === 'string' ? fields.speakerId : undefined;
    if (!speakerId) return undefined;
    return {
      speakerId,
      label: speakerTranscriptLabel(speakerId, entity?.name),
      ...(entity ? { entity } : {}),
    };
  }
  if (entity) return { label: entity.name, entity };
  const speakerTag = fields.speakerTag;
  if (typeof speakerTag === 'number') {
    return { label: `Speaker tag ${speakerTag}` };
  }
  return undefined;
}

interface ClipContext {
  clipId: string;
  domain: 'mediaClip' | 'timelineClip';
  mediaId: string;
  editListSource: EditListSource;
  windowed: CompositeSegment[];
  times: ClipTimes;
  placement?: ClipTranscriptResult['placement'];
}

async function transcriptFor(
  pb: TypedPocketBase,
  ctx: ClipContext,
  opts: TranscriptOptions
): Promise<ClipTranscriptResult> {
  const window = {
    start: Math.min(...ctx.windowed.map((s) => s.start)),
    end: Math.max(...ctx.windowed.map((s) => s.end)),
  };

  let labelType: TranscriptLabelType | null;
  let rows: LabelRecord[];
  if (opts.type) {
    rows = await fetchUtterances(
      pb,
      opts.type === 'speaker' ? LabelType.SPEAKER : LabelType.SPEECH,
      ctx.mediaId,
      window
    );
    labelType = rows.length > 0 ? opts.type : null;
  } else {
    // Speaker labels first — the diarized transcription is usually the
    // better one; fall back to speech only when no speaker rows overlap.
    rows = await fetchUtterances(pb, LabelType.SPEAKER, ctx.mediaId, window);
    labelType = 'speaker';
    if (rows.length === 0) {
      rows = await fetchUtterances(pb, LabelType.SPEECH, ctx.mediaId, window);
      labelType = rows.length > 0 ? 'speech' : null;
    }
  }

  const transcript = buildClipTranscript(
    rows as unknown as UtteranceLike[],
    ctx.windowed
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const placedStart = ctx.placement?.timelineStart;

  const utterances: TranscriptUtteranceView[] = transcript.utterances.map(
    (u) => {
      const record = byId.get(u.id);
      const speaker =
        record && labelType ? speakerOf(record, labelType) : undefined;
      return {
        ...u,
        parts: u.parts.map((part) => ({
          ...(opts.words ? part : { ...part, words: undefined }),
          ...(placedStart !== undefined
            ? {
                timelineStart: roundToMs(placedStart + part.clipStart),
                timelineEnd: roundToMs(placedStart + part.clipEnd),
              }
            : {}),
        })),
        ...(speaker ? { speaker } : {}),
        ...(placedStart !== undefined
          ? {
              timelineStart: roundToMs(placedStart + u.clipStart),
              timelineEnd: roundToMs(placedStart + u.clipEnd),
            }
          : {}),
      };
    }
  );

  const text = utterances
    .map((u) => (u.speaker ? `${u.speaker.label}: ${u.text}` : u.text))
    .join('\n');

  return {
    clipId: ctx.clipId,
    domain: ctx.domain,
    mediaId: ctx.mediaId,
    labelType,
    labelTypeSelected: opts.type ? 'forced' : 'auto',
    editListSource: ctx.editListSource,
    segments: ctx.windowed,
    gaps: segmentGapsOf(ctx.windowed),
    times: ctx.times,
    ...(ctx.placement ? { placement: ctx.placement } : {}),
    utterances,
    totals: transcript.totals,
    text,
  };
}

async function requireMedia(
  pb: TypedPocketBase,
  clipId: string,
  mediaId: string
) {
  const media = await new MediaMutator(pb).getById(mediaId);
  if (!media) {
    throw new Error(`Media not found for clip ${clipId}: ${mediaId}`);
  }
  return media;
}

/** Edit-list-aware transcript of a library MediaClip. */
export async function mediaClipTranscript(
  pb: TypedPocketBase,
  clipId: string,
  opts: TranscriptOptions = {}
): Promise<ClipTranscriptResult> {
  const clip = await requireMediaClip(pb, clipId);
  const media = await requireMedia(pb, clipId, clip.MediaRef);
  const existing = getCompositeSegments(clip);
  const normalized = normalizeSegments(
    existing?.length ? existing : [{ start: clip.start, end: clip.end }],
    mediaBounds(media)
  );
  return transcriptFor(
    pb,
    {
      clipId,
      domain: 'mediaClip',
      mediaId: media.id,
      editListSource: existing?.length ? 'clipData' : 'trim',
      windowed: windowCompositeSegments(normalized, clip.start, clip.end),
      times: mediaClipTimes(clip),
    },
    opts
  );
}

/** Edit-list-aware transcript of a placed TimelineClip. */
export async function timelineClipTranscript(
  pb: TypedPocketBase,
  clipId: string,
  opts: TranscriptOptions = {}
): Promise<ClipTranscriptResult> {
  const clip = await new TimelineClipMutator(pb).getById(clipId);
  if (!clip) {
    throw new Error(`Timeline clip not found: ${clipId}`);
  }
  assertOnTimeline(clip, opts.timelineId);
  if (!clip.MediaRef) {
    throw new Error(
      `Clip ${clipId} has no source media — transcripts apply to ` +
        `media-backed clips, not captions or nested timelines.`
    );
  }
  const media = await requireMedia(pb, clipId, clip.MediaRef);
  const editList = await resolveTimelineEditList(pb, clip);
  const normalized = normalizeSegments(editList.segments, mediaBounds(media));

  const { track, entries } = await resolveClipLane(pb, clip);
  const entry = entries.find((e) => e.clip.id === clipId);
  const placement = entry
    ? {
        timelineId: clip.TimelineRef,
        layer: track.layer,
        timelineStart: entry.range.start,
        timelineEnd: entry.range.end,
      }
    : undefined;

  return transcriptFor(
    pb,
    {
      clipId,
      domain: 'timelineClip',
      mediaId: media.id,
      editListSource: editList.source,
      windowed: windowCompositeSegments(normalized, clip.start, clip.end),
      times: timelineClipTimes(clip, placement),
      ...(placement ? { placement } : {}),
    },
    opts
  );
}
