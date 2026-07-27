import { LabelType } from '../enums';
import { entityAttributionFilter } from './entity';

/** The PB collection name backing each label type. */
export type LabelCollectionName =
  | 'LabelObjects'
  | 'LabelShots'
  | 'LabelPerson'
  | 'LabelSpeech'
  | 'LabelSpeaker'
  | 'LabelFaces'
  | 'LabelSegments'
  | 'LabelText';

export interface LabelTypeMeta {
  collection: LabelCollectionName;
  /**
   * Whether rows carry a LabelTrackRef relation (track payload: keyframes,
   * bounding boxes). Shots and segments are classifications, not tracked
   * instances, so filters or expands referencing LabelTrackRef would be a
   * PocketBase unknown-field error there. Entity attribution doesn't depend
   * on this — every type links through LabelEntityRef.
   */
  hasTrack: boolean;
  /** Confidence field name — LabelFaces uses avgConfidence. */
  confidenceField: 'confidence' | 'avgConfidence';
  /** Display plural, e.g. "Objects", "Speakers". */
  title: string;
}

/** Per-label-type structural facts shared by the CLI and webapp. */
export const LABEL_TYPE_META: Record<LabelType, LabelTypeMeta> = {
  [LabelType.OBJECT]: {
    collection: 'LabelObjects',
    hasTrack: true,
    confidenceField: 'confidence',
    title: 'Objects',
  },
  [LabelType.SHOT]: {
    collection: 'LabelShots',
    hasTrack: false,
    confidenceField: 'confidence',
    title: 'Shots',
  },
  [LabelType.PERSON]: {
    collection: 'LabelPerson',
    hasTrack: true,
    confidenceField: 'confidence',
    title: 'People',
  },
  [LabelType.SPEECH]: {
    collection: 'LabelSpeech',
    hasTrack: true,
    confidenceField: 'confidence',
    title: 'Speech',
  },
  [LabelType.SPEAKER]: {
    collection: 'LabelSpeaker',
    hasTrack: true,
    confidenceField: 'confidence',
    title: 'Speakers',
  },
  [LabelType.FACE]: {
    collection: 'LabelFaces',
    hasTrack: true,
    confidenceField: 'avgConfidence',
    title: 'Faces',
  },
  [LabelType.SEGMENT]: {
    collection: 'LabelSegments',
    hasTrack: false,
    confidenceField: 'confidence',
    title: 'Segments',
  },
  [LabelType.TEXT]: {
    collection: 'LabelText',
    hasTrack: true,
    confidenceField: 'confidence',
    title: 'Text',
  },
};

/**
 * PB filter matching one label type's rows attributed to an entity.
 *
 * No longer dispatches on `hasTrack`: every type resolves through
 * LabelEntityRef, the one ref all eight leaf collections share. Kept as a
 * named wrapper so call sites read by intent, and because the type argument
 * documents what is being filtered.
 */
export function labelAttributionFilter(
  _type: LabelType,
  entityId: string
): string {
  return entityAttributionFilter(entityId);
}

/**
 * Expand paths that resolve a label row's attributed Entity. One path for
 * every type — the row's LabelEntity carries the link.
 */
export function attributionExpands(_type: LabelType): string[] {
  return ['LabelEntityRef.EntityRef'];
}
