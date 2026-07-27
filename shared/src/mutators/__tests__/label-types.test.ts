import { describe, it, expect } from 'vitest';
import { LabelType } from '../../enums';
import {
  LABEL_TYPE_META,
  attributionExpands,
  labelAttributionFilter,
} from '../label-types';
import { entityAttributionFilter } from '../entity';

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
  it('resolves every label type through the same single hop', () => {
    // LabelEntity is the one link point now — per-media and per-instance, so
    // there is nothing for a track link to take precedence over. Every type
    // gets the identical filter, including the two with no track at all.
    for (const type of [...TRACK_TYPES, ...CLUSTER_ONLY_TYPES]) {
      expect(labelAttributionFilter(type, 'e1')).toBe(
        entityAttributionFilter('e1')
      );
    }
  });

  it('never references LabelTrackRef', () => {
    // LabelShots/LabelSegments have no LabelTrackRef field, so a filter
    // mentioning it would be a PocketBase unknown-field error there. Now that
    // the filter is uniform, that has to hold for every type.
    for (const type of [...TRACK_TYPES, ...CLUSTER_ONLY_TYPES]) {
      expect(labelAttributionFilter(type, 'e1')).not.toContain('LabelTrackRef');
    }
  });
});

describe('attributionExpands', () => {
  it('expands the one link point for every type', () => {
    for (const type of [...TRACK_TYPES, ...CLUSTER_ONLY_TYPES]) {
      expect(attributionExpands(type)).toEqual(['LabelEntityRef.EntityRef']);
    }
  });
});
