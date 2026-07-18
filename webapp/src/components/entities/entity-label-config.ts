import { LabelType, speakerTranscriptLabel } from '@project/shared';
import { LABEL_TYPE_META } from '@project/shared/mutator';
import type { LabelSpeaker, LabelSpeech } from '@project/shared';
import {
  INSPECTOR_CONFIGS,
  type InspectorTypeConfig,
} from '@/components/labels/inspector/config';
import { truncateWords } from '@/components/labels/inspector/derive-clip-label';
import type { EntityLabelRow } from '@/hooks/use-entity-labels';

/**
 * Per-label-type display config for the entity detail page's labels browser.
 * Structural facts come from the shared LABEL_TYPE_META; row titles and
 * detail extras delegate to the media inspector's configs where one exists
 * (speaker/speech have no inspector page, so they get entries here).
 */
export interface EntityLabelTypeConfig {
  labelType: LabelType;
  /** Display plural, e.g. "Faces". */
  title: string;
  /** Route segment under /ws/{ws}/media/{id}/labels/ for this type. */
  mediaLabelsRoute: string;
  rowTitle: (row: EntityLabelRow, entityName: string) => string;
  detailExtras?: (
    row: EntityLabelRow
  ) => Array<{ label: string; value: string }>;
}

const inspectorByType = new Map<LabelType, InspectorTypeConfig>(
  INSPECTOR_CONFIGS.map((config) => [config.labelType, config])
);

function fromInspector(
  labelType: LabelType,
  mediaLabelsRoute: string
): EntityLabelTypeConfig {
  const inspector = inspectorByType.get(labelType);
  if (!inspector) {
    throw new Error(`No inspector config for label type ${labelType}`);
  }
  return {
    labelType,
    title: LABEL_TYPE_META[labelType].title,
    mediaLabelsRoute,
    rowTitle: (row) => inspector.listTitle(row),
    detailExtras: inspector.detailExtras,
  };
}

/** Types in tab order; tabs render only for types with attributed labels. */
export const ENTITY_LABEL_CONFIGS: EntityLabelTypeConfig[] = [
  {
    labelType: LabelType.SPEAKER,
    title: LABEL_TYPE_META[LabelType.SPEAKER].title,
    mediaLabelsRoute: 'speakers',
    rowTitle: (row, entityName) => {
      const speaker = row as LabelSpeaker;
      return (
        truncateWords(speaker.transcript) ||
        speakerTranscriptLabel(speaker.speakerId, entityName)
      );
    },
    detailExtras: (row) => {
      const speaker = row as LabelSpeaker;
      return [
        {
          label: 'Speaker',
          value: speakerTranscriptLabel(speaker.speakerId),
        },
        { label: 'Language', value: speaker.languageCode || 'Unknown' },
        { label: 'Transcript', value: speaker.transcript },
      ];
    },
  },
  fromInspector(LabelType.FACE, 'faces'),
  fromInspector(LabelType.OBJECT, 'objects'),
  fromInspector(LabelType.PERSON, 'people'),
  {
    labelType: LabelType.SPEECH,
    title: LABEL_TYPE_META[LabelType.SPEECH].title,
    mediaLabelsRoute: 'transcripts',
    rowTitle: (row) => {
      const speech = row as LabelSpeech;
      return truncateWords(speech.transcript) || `Speech ${row.id.slice(0, 8)}`;
    },
    detailExtras: (row) => {
      const speech = row as LabelSpeech;
      return [
        { label: 'Language', value: speech.languageCode || 'Unknown' },
        { label: 'Transcript', value: speech.transcript },
      ];
    },
  },
  fromInspector(LabelType.TEXT, 'text'),
  fromInspector(LabelType.SHOT, 'shots'),
  fromInspector(LabelType.SEGMENT, 'segments'),
];

/** A row's confidence via its type's field (faces use avgConfidence). */
export function entityLabelConfidence(
  labelType: LabelType,
  row: EntityLabelRow
): number {
  const value = (row as unknown as Record<string, unknown>)[
    LABEL_TYPE_META[labelType].confidenceField
  ];
  return typeof value === 'number' ? value : 0;
}
