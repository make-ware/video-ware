import { describe, it, expect } from 'vitest';
import { LabelTrackSchema } from '../../schema/label-track';
import {
  TRACK_KEYFRAME_FIELDS,
  TRACK_SUMMARY_FIELDS,
  TRACK_SUMMARY_OMITTED_FIELDS,
} from '../label-track';

/**
 * TRACK_SUMMARY_FIELDS is a PocketBase `fields` projection, and PocketBase has
 * no exclusion syntax — the list enumerates what to keep. That makes it drift
 * silently: adding a LabelTrack column would leave it absent from every track
 * listing with no error anywhere. These tests turn that into a failure.
 */
describe('TRACK_SUMMARY_FIELDS', () => {
  const projected = new Set<string>(TRACK_SUMMARY_FIELDS);
  const omitted = new Set<string>(TRACK_SUMMARY_OMITTED_FIELDS);

  it('accounts for every LabelTrack field', () => {
    const unaccounted = Object.keys(LabelTrackSchema.shape).filter(
      (field) => !projected.has(field) && !omitted.has(field)
    );
    expect(unaccounted).toEqual([]);
  });

  it('projects no field that is also marked omitted', () => {
    const both = [...projected].filter((field) => omitted.has(field));
    expect(both).toEqual([]);
  });

  it('names only real LabelTrack fields outside the expand paths', () => {
    const columns = new Set(Object.keys(LabelTrackSchema.shape));
    const unknown = TRACK_SUMMARY_FIELDS.filter(
      (field) => !field.startsWith('expand.') && !columns.has(field)
    );
    expect(unknown).toEqual([]);
  });

  it('drops the 10MB per-frame geometry — the whole point', () => {
    expect(projected.has('keyframes')).toBe(false);
    expect(omitted.has('keyframes')).toBe(true);
  });

  it('drops the retired EntityRef so nothing can start reading it again', () => {
    expect(projected.has('EntityRef')).toBe(false);
    expect(omitted.has('EntityRef')).toBe(true);
  });

  it('keeps boundingBox — the summary geometry that replaces keyframes', () => {
    expect(projected.has('boundingBox')).toBe(true);
  });

  it('keeps trackData, which carries the honest frame count', () => {
    // `trackData.frameCount` is how a listing reports frame counts without
    // reading a single keyframe byte.
    expect(projected.has('trackData')).toBe(true);
  });

  it('keeps the expands alive — naming any field strips them otherwise', () => {
    // MediaRef (+ its UploadRef, for the original filename) names the media a
    // track belongs to; LabelEntityRef (+ its EntityRef) resolves "this track
    // is Erik", the only live attribution path.
    for (const path of [
      'expand.MediaRef.*',
      'expand.MediaRef.expand.UploadRef.*',
      'expand.LabelEntityRef.*',
      'expand.LabelEntityRef.expand.EntityRef.*',
    ]) {
      expect(projected.has(path)).toBe(true);
    }
  });

  it('keeps the range fields every track listing sorts and filters on', () => {
    for (const field of [
      'start',
      'end',
      'duration',
      'confidence',
      'labelType',
    ]) {
      expect(projected.has(field)).toBe(true);
    }
  });
});

describe('TRACK_KEYFRAME_FIELDS', () => {
  const keyframe = new Set<string>(TRACK_KEYFRAME_FIELDS);

  it('reads the heavy column and its id, and nothing else', () => {
    expect([...keyframe].sort()).toEqual(['id', 'keyframes']);
  });

  it('is disjoint from the summary projection apart from the id', () => {
    const summary = new Set<string>(TRACK_SUMMARY_FIELDS);
    const overlap = [...keyframe].filter((field) => summary.has(field));
    expect(overlap).toEqual(['id']);
  });
});
