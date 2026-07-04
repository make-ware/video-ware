import { LabelType } from '@project/shared';
import type {
  LabelFace,
  LabelObject,
  LabelPerson,
  LabelSegment,
  LabelShot,
  LabelText,
} from '@project/shared';
import type { ActualizableLabel } from '@project/shared/mutator';
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
 * Per-label-type configuration driving the generic inspector page — the
 * webapp analog of the CLI's LABEL_TYPE_CONFIG (cli/src/lib/label.ts).
 */
export interface InspectorTypeConfig {
  /** Route segment under /labels/, also used as the tab key. */
  key: string;
  labelType: LabelType;
  collection:
    | 'LabelObjects'
    | 'LabelShots'
    | 'LabelPerson'
    | 'LabelFaces'
    | 'LabelSegments'
    | 'LabelText';
  title: string;
  /** Subtitle under the list card title. */
  subtitle: string;
  /** LabelFaces stores avgConfidence; every other collection: confidence. */
  confidenceField: 'confidence' | 'avgConfidence';
  /** Fields matched with `~` by the filter bar's text search; empty hides it. */
  queryFields: string[];
  preview: InspectorPreview;
  defaultFilters: InspectorFilterDefaults;
  defaultSort: string;
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
    config.confidenceField
  ];
  return typeof value === 'number' ? value : 0;
}

export const OBJECTS_CONFIG: InspectorTypeConfig = {
  key: 'objects',
  labelType: LabelType.OBJECT,
  collection: 'LabelObjects',
  title: 'Objects',
  subtitle: 'Found objects in this media',
  confidenceField: 'confidence',
  queryFields: ['entity'],
  preview: 'track',
  defaultFilters: { minConfidence: 0.85, minDuration: 5 },
  defaultSort: 'start',
  listTitle: (r) => (r as LabelObject).entity,
};

export const FACES_CONFIG: InspectorTypeConfig = {
  key: 'faces',
  labelType: LabelType.FACE,
  collection: 'LabelFaces',
  title: 'Faces',
  subtitle: 'Detected faces',
  confidenceField: 'avgConfidence',
  queryFields: ['faceId'],
  preview: 'track',
  defaultFilters: { minConfidence: 0, minDuration: 2 },
  defaultSort: 'start',
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
  collection: 'LabelPerson',
  title: 'People',
  subtitle: 'Detected people',
  confidenceField: 'confidence',
  queryFields: ['personId', 'upperBodyColor', 'lowerBodyColor'],
  preview: 'track',
  defaultFilters: { minConfidence: 0.85, minDuration: 5 },
  defaultSort: 'start',
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
  collection: 'LabelShots',
  title: 'Shots',
  subtitle: 'Detected shots',
  confidenceField: 'confidence',
  queryFields: ['entity'],
  preview: 'filmstrip',
  defaultFilters: { minConfidence: 0.85, minDuration: 5 },
  defaultSort: 'start',
  listTitle: (r) => (r as LabelShot).entity,
};

export const SEGMENTS_CONFIG: InspectorTypeConfig = {
  key: 'segments',
  labelType: LabelType.SEGMENT,
  collection: 'LabelSegments',
  title: 'Segments',
  subtitle: 'Segment-level labels',
  confidenceField: 'confidence',
  queryFields: ['entity'],
  preview: 'filmstrip',
  defaultFilters: { minConfidence: 0, minDuration: 0 },
  defaultSort: 'start',
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
  collection: 'LabelText',
  title: 'Text',
  subtitle: 'Text detected on screen',
  confidenceField: 'confidence',
  queryFields: ['text'],
  preview: 'filmstrip',
  defaultFilters: { minConfidence: 0, minDuration: 0 },
  defaultSort: 'start',
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
