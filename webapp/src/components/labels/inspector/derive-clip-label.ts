import { LabelType } from '@project/shared';
import type { LabelSpeech } from '@project/shared';
import type { ActualizableLabel } from '@project/shared/mutator';

const MAX_LABEL_WORDS = 8;
const MAX_DESCRIPTION_CHARS = 500;

export interface DerivedClipMeta {
  label: string;
  description?: string;
}

/** First `maxWords` words of `text`, with an ellipsis when truncated. */
export function truncateWords(
  text: string,
  maxWords = MAX_LABEL_WORDS
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export function truncateChars(
  text: string,
  maxChars = MAX_DESCRIPTION_CHARS
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Default MediaClip label/description for a clip derived from a label row,
 * so one-click clips are immediately identifiable and searchable.
 */
export function deriveClipMeta(
  labelType: LabelType,
  record: ActualizableLabel
): DerivedClipMeta {
  const shortId = record.id.slice(0, 8);

  switch (labelType) {
    case LabelType.OBJECT:
    case LabelType.SHOT:
    case LabelType.SEGMENT: {
      const entity = 'entity' in record ? record.entity : '';
      return { label: capitalize(entity) || `Label ${shortId}` };
    }
    case LabelType.SPEECH: {
      const transcript = 'transcript' in record ? record.transcript : '';
      return {
        label: truncateWords(transcript) || `Speech ${shortId}`,
        description: truncateChars(transcript) || undefined,
      };
    }
    case LabelType.SPEAKER: {
      const transcript = 'transcript' in record ? record.transcript : '';
      const speakerId = 'speakerId' in record ? record.speakerId : '';
      return {
        label: truncateWords(transcript) || `Speaker ${speakerId || shortId}`,
        description: truncateChars(transcript) || undefined,
      };
    }
    case LabelType.TEXT: {
      const text = 'text' in record ? record.text : '';
      return {
        label: truncateWords(text) || `Text ${shortId}`,
        description: truncateChars(text) || undefined,
      };
    }
    case LabelType.FACE: {
      const faceId = 'faceId' in record ? record.faceId : '';
      return { label: `Face ${faceId || shortId}` };
    }
    case LabelType.PERSON: {
      const personId = 'personId' in record ? record.personId : '';
      return { label: `Person ${personId || shortId}` };
    }
  }
}

/** Label/description for a clip merged from several speech segments. */
export function deriveMergedSpeechMeta(
  segments: LabelSpeech[]
): DerivedClipMeta {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const firstWords = truncateWords(sorted[0]?.transcript ?? '') || 'Speech';
  const plural = segments.length === 1 ? 'segment' : 'segments';
  return {
    label: `${firstWords} (${segments.length} ${plural})`,
    description:
      truncateChars(sorted.map((s) => s.transcript).join(' ')) || undefined,
  };
}
