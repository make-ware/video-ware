import { describe, it, expect } from 'vitest';
import { LabelSpeakerSchema } from '../../schema/label-speaker';
import {
  SPEAKER_PANEL_FIELDS,
  SPEAKER_PANEL_OMITTED_FIELDS,
} from '../label-speaker';

/**
 * SPEAKER_PANEL_FIELDS is a PocketBase `fields` projection, and PocketBase has
 * no exclusion syntax — the list enumerates what to keep. That makes it drift
 * silently: adding a LabelSpeaker column would leave it absent from every
 * speaker surface with no error anywhere. These tests turn that into a
 * failure.
 */
describe('SPEAKER_PANEL_FIELDS', () => {
  const projected = new Set<string>(SPEAKER_PANEL_FIELDS);
  const omitted = new Set<string>(SPEAKER_PANEL_OMITTED_FIELDS);

  it('accounts for every LabelSpeaker field', () => {
    const unaccounted = Object.keys(LabelSpeakerSchema.shape).filter(
      (field) => !projected.has(field) && !omitted.has(field)
    );
    expect(unaccounted).toEqual([]);
  });

  it('projects no field that is also marked omitted', () => {
    const both = [...projected].filter((field) => omitted.has(field));
    expect(both).toEqual([]);
  });

  it('names only real LabelSpeaker fields outside the expand paths', () => {
    const columns = new Set(Object.keys(LabelSpeakerSchema.shape));
    const unknown = SPEAKER_PANEL_FIELDS.filter(
      (field) => !field.startsWith('expand.') && !columns.has(field)
    );
    expect(unknown).toEqual([]);
  });

  it('drops the heavy per-word timings', () => {
    expect(projected.has('words')).toBe(false);
    expect(omitted.has('words')).toBe(true);
  });

  it('keeps the expands alive — naming any field strips them otherwise', () => {
    // One expand carries both: LabelEntityRef supplies the speaker's display
    // name, and its own EntityRef the "this speaker is Erik" link.
    expect(projected.has('expand.LabelEntityRef.*')).toBe(true);
    expect(projected.has('expand.LabelEntityRef.expand.EntityRef.*')).toBe(
      true
    );
  });

  it('keeps the fields the clip-from-label writer reads', () => {
    for (const field of ['id', 'confidence', 'transcript', 'speakerId']) {
      expect(projected.has(field)).toBe(true);
    }
  });
});
