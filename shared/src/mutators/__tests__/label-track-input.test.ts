import { describe, it, expect } from 'vitest';
import { LabelType } from '../../enums';
import { LabelTrackInputSchema } from '../../schema/label-track';

const baseInput = {
  WorkspaceRef: 'ws1',
  MediaRef: 'media1',
  trackId: 'speaker_0',
  trackHash: 'hash',
  start: 0,
  end: 10,
  duration: 10,
  confidence: 0.9,
  keyframes: [],
  trackData: {},
};

/**
 * LabelTrackInputSchema is a non-strict z.object, so `parse` silently drops
 * any key it doesn't declare — that is why the worker's provider/processor/
 * version writes never reach the database. labelType has to be declared or it
 * would vanish the same way, with nothing failing to say so.
 */
describe('LabelTrackInputSchema', () => {
  it('persists labelType', () => {
    const parsed = LabelTrackInputSchema.parse({
      ...baseInput,
      labelType: LabelType.SPEAKER,
    });
    expect(parsed.labelType).toBe(LabelType.SPEAKER);
  });

  it('accepts every LabelType', () => {
    for (const labelType of Object.values(LabelType)) {
      expect(
        LabelTrackInputSchema.parse({ ...baseInput, labelType }).labelType
      ).toBe(labelType);
    }
  });

  it('rejects a labelType outside the enum', () => {
    expect(() =>
      LabelTrackInputSchema.parse({ ...baseInput, labelType: 'nonsense' })
    ).toThrow();
  });

  it('stays optional — tracks written without a cluster have no type', () => {
    expect(LabelTrackInputSchema.parse(baseInput).labelType).toBeUndefined();
  });

  it('still drops the columns LabelTrack no longer has', () => {
    const parsed = LabelTrackInputSchema.parse({
      ...baseInput,
      provider: 'elevenlabs',
      processor: 'speaker-transcription:1.0.0',
      version: 1,
    });
    expect(parsed).not.toHaveProperty('provider');
    expect(parsed).not.toHaveProperty('processor');
    expect(parsed).not.toHaveProperty('version');
  });
});
