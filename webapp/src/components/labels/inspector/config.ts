import { LabelType } from '@project/shared';
import type {
  LabelFace,
  LabelObject,
  LabelPerson,
  LabelSegment,
  LabelShot,
  LabelText,
} from '@project/shared';
import {
  LABEL_TYPE_META,
  type ActualizableLabel,
} from '@project/shared/mutator';
import { truncateWords } from './derive-clip-label';

/**
 * How the detail panel previews a selected label:
 * - track: filmstrip animation with the label track's bounding-box overlay
 * - filmstrip: filmstrip animation of the label's time range (no track)
 */
export type InspectorPreview = 'track' | 'filmstrip';

export interface InspectorFilterDefaults {
  minConfidence: number;
  minDuration: number;
}

/**
 * Per-label-type PRESENTATION for the generic inspector page — the webapp
 * analog of the CLI's LABEL_TYPE_CONFIG (cli/src/lib/label.ts).
 *
 * Presentation only. Structural facts (which collection backs the type, which
 * column holds its confidence) live once in the shared LABEL_TYPE_META, and
 * how the type is read (sort, expands, searchable fields, page size) lives once
 * in LABEL_LIST_SOURCES (hooks/use-label-list.ts) — both keyed by `labelType`,
 * which is all this config needs to carry to reach them.
 */
export interface InspectorTypeConfig {
  /** Route segment under /labels/, also used as the tab key. */
  key: string;
  labelType: LabelType;
  title: string;
  /** Subtitle under the list card title. */
  subtitle: string;
  preview: InspectorPreview;
  defaultFilters: InspectorFilterDefaults;
  listTitle: (record: ActualizableLabel) => string;
  /** Extra stat tiles below the timing row. */
  detailExtras?: (
    record: ActualizableLabel
  ) => Array<{ label: string; value: string }>;
}

function shortId(record: ActualizableLabel): string {
  return record.id.slice(0, 8);
}

/** Confidence of a record via the type's field (FACE uses avgConfidence). */
export function confidenceOf(
  config: InspectorTypeConfig,
  record: ActualizableLabel
): number {
  const value = (record as unknown as Record<string, unknown>)[
    LABEL_TYPE_META[config.labelType].confidenceField
  ];
  return typeof value === 'number' ? value : 0;
}

export const OBJECTS_CONFIG: InspectorTypeConfig = {
  key: 'objects',
  labelType: LabelType.OBJECT,
  title: 'Objects',
  subtitle: 'Found objects in this media',
  preview: 'track',
  defaultFilters: { minConfidence: 0.85, minDuration: 5 },
  listTitle: (r) => (r as LabelObject).entity,
};

export const FACES_CONFIG: InspectorTypeConfig = {
  key: 'faces',
  labelType: LabelType.FACE,
  title: 'Faces',
  subtitle: 'Detected faces',
  preview: 'track',
  defaultFilters: { minConfidence: 0, minDuration: 2 },
  listTitle: (r) => `Face ${(r as LabelFace).faceId || shortId(r)}`,
  detailExtras: (r) => {
    const face = r as LabelFace;
    return [
      { label: 'Joy', value: face.joyLikelihood || 'Unknown' },
      { label: 'Sorrow', value: face.sorrowLikelihood || 'Unknown' },
      { label: 'Anger', value: face.angerLikelihood || 'Unknown' },
      { label: 'Surprise', value: face.surpriseLikelihood || 'Unknown' },
      { label: 'Headwear', value: face.headwearLikelihood || 'Unknown' },
      { label: 'Blurred', value: face.blurredLikelihood || 'Unknown' },
      {
        label: 'Looking at Camera',
        value: face.lookingAtCameraLikelihood || 'Unknown',
      },
    ];
  },
};

export const PEOPLE_CONFIG: InspectorTypeConfig = {
  key: 'people',
  labelType: LabelType.PERSON,
  title: 'People',
  subtitle: 'Detected people',
  preview: 'track',
  defaultFilters: { minConfidence: 0.85, minDuration: 5 },
  listTitle: (r) => `Person ${(r as LabelPerson).personId || shortId(r)}`,
  detailExtras: (r) => {
    const person = r as LabelPerson;
    return [
      { label: 'Upper Body', value: person.upperBodyColor || 'Unknown' },
      { label: 'Lower Body', value: person.lowerBodyColor || 'Unknown' },
    ];
  },
};

export const SHOTS_CONFIG: InspectorTypeConfig = {
  key: 'shots',
  labelType: LabelType.SHOT,
  title: 'Shots',
  subtitle: 'Detected shots',
  preview: 'filmstrip',
  defaultFilters: { minConfidence: 0.85, minDuration: 5 },
  listTitle: (r) => (r as LabelShot).entity,
};

export const SEGMENTS_CONFIG: InspectorTypeConfig = {
  key: 'segments',
  labelType: LabelType.SEGMENT,
  title: 'Segments',
  subtitle: 'Segment-level labels',
  preview: 'filmstrip',
  defaultFilters: { minConfidence: 0, minDuration: 0 },
  listTitle: (r) => (r as LabelSegment).entity,
  detailExtras: (r) => {
    const labelType = (r as LabelSegment).labelType;
    return [
      {
        label: 'Label Type',
        value: Array.isArray(labelType)
          ? labelType.join(', ')
          : String(labelType || 'Unknown'),
      },
    ];
  },
};

export const TEXT_CONFIG: InspectorTypeConfig = {
  key: 'text',
  labelType: LabelType.TEXT,
  title: 'Text',
  subtitle: 'Text detected on screen',
  preview: 'filmstrip',
  defaultFilters: { minConfidence: 0, minDuration: 0 },
  listTitle: (r) =>
    truncateWords((r as LabelText).text) || `Text ${shortId(r)}`,
  detailExtras: (r) => [{ label: 'Full Text', value: (r as LabelText).text }],
};

/** Tab/page order for the entity-style inspector tabs. */
export const INSPECTOR_CONFIGS: InspectorTypeConfig[] = [
  OBJECTS_CONFIG,
  FACES_CONFIG,
  PEOPLE_CONFIG,
  SHOTS_CONFIG,
  SEGMENTS_CONFIG,
  TEXT_CONFIG,
];
