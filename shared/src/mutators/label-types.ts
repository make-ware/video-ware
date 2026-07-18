import { LabelType } from '../enums';
import {
  clusterEntityAttributionFilter,
  entityAttributionFilter,
} from './entity';

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
   * Whether rows carry a LabelTrackRef link point. Shots and segments are
   * classifications, not tracked instances, so their only entity link is
   * the provider cluster — filters referencing LabelTrackRef would be a
   * PocketBase unknown-field error there.
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
 * PB filter matching one label type's rows attributed to an entity, using
 * the link points that type actually has (track > cluster, or cluster only).
 */
export function labelAttributionFilter(
  type: LabelType,
  entityId: string
): string {
  return LABEL_TYPE_META[type].hasTrack
    ? entityAttributionFilter(entityId)
    : clusterEntityAttributionFilter(entityId);
}

/**
 * Expand paths that resolve a label row's attributed Entity: the row's track
 * link and its provider cluster's link, skipping LabelTrackRef where the
 * collection lacks it.
 */
export function attributionExpands(type: LabelType): string[] {
  return LABEL_TYPE_META[type].hasTrack
    ? ['LabelTrackRef.EntityRef', 'LabelEntityRef.EntityRef']
    : ['LabelEntityRef.EntityRef'];
}
