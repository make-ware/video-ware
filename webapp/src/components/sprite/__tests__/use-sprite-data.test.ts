import { describe, it, expect } from 'vitest';
import type { Media } from '@project/shared';
import { spriteTileAspect, type SpriteConfig } from '../use-sprite-data';

/** Minimal media shape the helper reads. */
function media(overrides: Partial<Media> = {}) {
  return {
    width: 1920,
    height: 1080,
    rotation: 0,
    mediaData: undefined,
    ...overrides,
  } as unknown as Pick<Media, 'width' | 'height' | 'rotation' | 'mediaData'>;
}

const config: SpriteConfig = {
  cols: 10,
  rows: 10,
  fps: 1,
  tileWidth: 320,
  tileHeight: 180,
};

describe('spriteTileAspect', () => {
  it('trusts the media over a stale stored tile height', () => {
    // Sheets written before the worker recorded its real geometry carry the
    // requested 320x180 even for portrait media; the media row is right.
    const aspect = spriteTileAspect(
      media({ width: 1080, height: 1920 }),
      config
    );
    expect(aspect).toBeCloseTo(1080 / 1920);
  });

  it('uses display dimensions for rotated media', () => {
    const aspect = spriteTileAspect(
      media({
        width: 1920,
        height: 1080,
        rotation: 90,
        mediaData: {
          width: 1920,
          height: 1080,
          displayWidth: 1080,
          displayHeight: 1920,
          rotation: 90,
        },
      } as Partial<Media>),
      config
    );
    expect(aspect).toBeCloseTo(1080 / 1920);
  });

  it('agrees with the stored config for ordinary 16:9 media', () => {
    expect(spriteTileAspect(media(), config)).toBeCloseTo(16 / 9);
  });

  it('falls back to the stored tile dimensions when the media has none', () => {
    expect(
      spriteTileAspect(media({ width: 0, height: 0 }), {
        ...config,
        tileHeight: 570,
      })
    ).toBeCloseTo(320 / 570);
  });

  it('returns null when neither source knows the shape', () => {
    expect(
      spriteTileAspect(media({ width: 0, height: 0 }), {
        cols: 10,
        rows: 10,
        fps: 1,
      })
    ).toBeNull();
  });
});
