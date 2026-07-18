import { describe, it, expect } from 'vitest';
import { LabelType } from '../../enums';
import {
  LABEL_TYPE_META,
  attributionExpands,
  labelAttributionFilter,
} from '../label-types';
import {
  clusterEntityAttributionFilter,
  entityAttributionFilter,
} from '../entity';

const TRACK_TYPES = [
  LabelType.OBJECT,
  LabelType.PERSON,
  LabelType.SPEECH,
  LabelType.SPEAKER,
  LabelType.FACE,
  LabelType.TEXT,
];
const CLUSTER_ONLY_TYPES = [LabelType.SHOT, LabelType.SEGMENT];

describe('LABEL_TYPE_META', () => {
  it('covers every LabelType', () => {
    for (const type of Object.values(LabelType)) {
      expect(LABEL_TYPE_META[type]).toBeDefined();
    }
  });

  it('marks exactly shots and segments as cluster-only', () => {
    const clusterOnly = Object.values(LabelType).filter(
      (type) => !LABEL_TYPE_META[type].hasTrack
    );
    expect(clusterOnly.sort()).toEqual([...CLUSTER_ONLY_TYPES].sort());
  });

  it('uses avgConfidence only for faces', () => {
    for (const type of Object.values(LabelType)) {
      expect(LABEL_TYPE_META[type].confidenceField).toBe(
        type === LabelType.FACE ? 'avgConfidence' : 'confidence'
      );
    }
  });
});

describe('labelAttributionFilter', () => {
  it('applies track-over-cluster precedence for track-bearing types', () => {
    for (const type of TRACK_TYPES) {
      expect(labelAttributionFilter(type, 'e1')).toBe(
        entityAttributionFilter('e1')
      );
    }
  });

  it('uses the cluster-only filter for shots and segments', () => {
    for (const type of CLUSTER_ONLY_TYPES) {
      const filter = labelAttributionFilter(type, 'e1');
      expect(filter).toBe(clusterEntityAttributionFilter('e1'));
      // LabelShots/LabelSegments have no LabelTrackRef field; referencing it
      // would be a PocketBase unknown-field error.
      expect(filter).not.toContain('LabelTrackRef');
    }
  });
});

describe('attributionExpands', () => {
  it('expands both link points for track-bearing types', () => {
    for (const type of TRACK_TYPES) {
      expect(attributionExpands(type)).toEqual([
        'LabelTrackRef.EntityRef',
        'LabelEntityRef.EntityRef',
      ]);
    }
  });

  it('skips LabelTrackRef for cluster-only types', () => {
    for (const type of CLUSTER_ONLY_TYPES) {
      expect(attributionExpands(type)).toEqual(['LabelEntityRef.EntityRef']);
    }
  });
});
