import type {
  Entity,
  LabelEntity,
  LabelSpeaker,
  LabelTrack,
} from '@project/shared';
import { prettySpeakerId, speakerTranscriptLabel } from '@project/shared';
import {
  truncateChars,
  truncateWords,
  type DerivedClipMeta,
} from '../inspector/derive-clip-label';

// Re-exported so speaker UI code has one import site; the format itself lives
// in @project/shared so the CLI renders speaker names identically.
export { prettySpeakerId, speakerTranscriptLabel };

/**
 * LabelSpeaker row with the optional expands requested by useMediaSpeakers.
 * PocketBase omits `expand` when a relation is unset, so every level is
 * optional. `LabelTrackRef.EntityRef` carries the manual "this speaker is
 * Erik" link, resolved live for transcript labels (never baked into text).
 */
export type SpeakerUtterance = LabelSpeaker & {
  expand?: {
    LabelEntityRef?: LabelEntity;
    LabelTrackRef?: LabelTrack & { expand?: { EntityRef?: Entity } };
  };
};

/**
 * Display name for an utterance's speaker: the linked LabelEntity's
 * canonical name when present (it survives renames), else the prettified
 * provider id.
 */
export function speakerNameOf(utterance: SpeakerUtterance): string {
  return (
    utterance.expand?.LabelEntityRef?.canonicalName ||
    prettySpeakerId(utterance.speakerId)
  );
}

/**
 * Name of the workspace Entity this speaker's track is linked to, read live
 * from the expanded LabelTrack.EntityRef — the "matched" identity. Null when
 * the speaker has not been identified.
 */
export function speakerEntityName(utterance: SpeakerUtterance): string | null {
  return utterance.expand?.LabelTrackRef?.expand?.EntityRef?.name || null;
}

/**
 * Transcript-facing speaker label: "Speaker 1 (Erik)" once the speaker is
 * linked to an Entity, else "Speaker 1". The name is resolved live from the
 * DB via the expand, so it stays current and is never persisted into
 * generated text.
 */
export function speakerTranscriptLabelFor(utterance: SpeakerUtterance): string {
  return speakerTranscriptLabel(
    utterance.speakerId,
    speakerEntityName(utterance)
  );
}

export interface SpeakerSummary {
  speakerId: string;
  name: string;
  utteranceCount: number;
  /** Sum of utterance durations in seconds (not the covered time range). */
  totalDuration: number;
  /** Stable palette index, assigned by order of first appearance. */
  colorIndex: number;
}

/**
 * One summary per distinct speaker, ordered by first appearance in the
 * (start-sorted) utterance list.
 */
export function deriveSpeakerSummaries(
  utterances: SpeakerUtterance[]
): SpeakerSummary[] {
  const byId = new Map<string, SpeakerSummary>();
  for (const u of utterances) {
    const existing = byId.get(u.speakerId);
    if (existing) {
      existing.utteranceCount += 1;
      existing.totalDuration += u.duration;
    } else {
      byId.set(u.speakerId, {
        speakerId: u.speakerId,
        name: speakerNameOf(u),
        utteranceCount: 1,
        totalDuration: u.duration,
        colorIndex: byId.size,
      });
    }
  }
  return [...byId.values()];
}

const SPEAKER_BADGE_CLASSES = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
];

const SPEAKER_DOT_CLASSES = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
];

export function speakerBadgeClass(colorIndex: number): string {
  return SPEAKER_BADGE_CLASSES[colorIndex % SPEAKER_BADGE_CLASSES.length];
}

export function speakerDotClass(colorIndex: number): string {
  return SPEAKER_DOT_CLASSES[colorIndex % SPEAKER_DOT_CLASSES.length];
}

/**
 * Plain-text diarized transcript: consecutive utterances by the same
 * speaker merge into one "Name: text" paragraph, paragraphs separated by
 * blank lines.
 *
 * `labelOf` picks the speaker prefix. It defaults to speakerNameOf so
 * persisted output (e.g. generated clip descriptions) is never tagged with a
 * live entity name; pass speakerTranscriptLabelFor for ephemeral output
 * (copy/preview) that should show "Speaker 1 (Erik)".
 */
export function formatDiarizedTranscript(
  utterances: SpeakerUtterance[],
  labelOf: (utterance: SpeakerUtterance) => string = speakerNameOf
): string {
  const paragraphs: string[] = [];
  let currentSpeakerId: string | null = null;

  for (const u of utterances) {
    if (u.speakerId === currentSpeakerId && paragraphs.length > 0) {
      paragraphs[paragraphs.length - 1] += ` ${u.transcript}`;
    } else {
      paragraphs.push(`${labelOf(u)}: ${u.transcript}`);
      currentSpeakerId = u.speakerId;
    }
  }
  return paragraphs.join('\n\n');
}

/**
 * Label/description for a clip merged from several speaker utterances —
 * the diarized counterpart of deriveMergedSpeechMeta. Single-speaker
 * selections are titled with the speaker's name, mixed ones as a
 * conversation; the description keeps the speaker-prefixed text.
 */
export function deriveMergedSpeakerMeta(
  segments: SpeakerUtterance[]
): DerivedClipMeta {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const names = [...new Set(sorted.map(speakerNameOf))];
  const prefix = names.length === 1 ? names[0] : 'Conversation';
  const firstWords = truncateWords(sorted[0]?.transcript ?? '');
  const plural = segments.length === 1 ? 'utterance' : 'utterances';
  return {
    label: firstWords
      ? `${prefix}: ${firstWords} (${segments.length} ${plural})`
      : `${prefix} (${segments.length} ${plural})`,
    description: truncateChars(formatDiarizedTranscript(sorted)) || undefined,
  };
}
