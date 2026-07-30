import { describe, it, expect } from 'vitest';
import {
  cropTile,
  decodeFilmstripJpeg,
  encodeJpeg,
  gridDividesExactly,
} from '../lib/frame-image.js';
import { centrePixel, makeSpriteSheet, TILE_COLOURS } from './jpeg-fixture.js';

/** JPEG is lossy even at q=100; compare colours with room to breathe. */
function expectColourNear(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
  tolerance = 12
) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe('decodeFilmstripJpeg', () => {
  it('decodes a sprite sheet to RGBA', () => {
    const sheet = makeSpriteSheet();
    const image = decodeFilmstripJpeg(sheet.jpeg, 'test sheet');
    expect(image.width).toBe(sheet.cols * sheet.tileWidth);
    expect(image.height).toBe(sheet.tileHeight);
    expect(image.data.length).toBe(image.width * image.height * 4);
  });

  it('names the subject when the bytes are not a JPEG', () => {
    expect(() =>
      decodeFilmstripJpeg(
        Buffer.from('not a jpeg at all'),
        'segment 2 of media m1'
      )
    ).toThrow(/Could not decode segment 2 of media m1/);
  });
});

describe('cropTile', () => {
  it('cuts out the requested tile', () => {
    const sheet = makeSpriteSheet();
    const image = decodeFilmstripJpeg(sheet.jpeg, 'test sheet');
    const tile = cropTile(image, { cols: sheet.cols, rows: sheet.rows }, 2);

    expect(tile.width).toBe(sheet.tileWidth);
    expect(tile.height).toBe(sheet.tileHeight);
    expectColourNear(centrePixel(tile), TILE_COLOURS[2]);
  });

  it('cuts a different tile for a different index', () => {
    const sheet = makeSpriteSheet();
    const image = decodeFilmstripJpeg(sheet.jpeg, 'test sheet');
    for (const index of [0, 1, 3]) {
      const tile = cropTile(
        image,
        { cols: sheet.cols, rows: sheet.rows },
        index
      );
      expectColourNear(centrePixel(tile), TILE_COLOURS[index]);
    }
  });

  it('derives tile size from the image, not a stored tile size', () => {
    // A sheet whose tiles are taller than 16:9 would imply — exactly the case
    // where meta.filmstripConfig.tileHeight lies.
    const sheet = makeSpriteSheet({ tileWidth: 16, tileHeight: 32 });
    const image = decodeFilmstripJpeg(sheet.jpeg, 'test sheet');
    const tile = cropTile(image, { cols: sheet.cols, rows: sheet.rows }, 1);
    expect(tile.width).toBe(16);
    expect(tile.height).toBe(32);
    expectColourNear(centrePixel(tile), TILE_COLOURS[1]);
  });

  it('clamps an out-of-range tile index to the last tile', () => {
    const sheet = makeSpriteSheet();
    const image = decodeFilmstripJpeg(sheet.jpeg, 'test sheet');
    const tile = cropTile(image, { cols: sheet.cols, rows: sheet.rows }, 99);
    expectColourNear(centrePixel(tile), TILE_COLOURS[sheet.cols - 1]);
  });
});

describe('encodeJpeg', () => {
  it('round trips a cropped tile back through a real JPEG', () => {
    const sheet = makeSpriteSheet();
    const image = decodeFilmstripJpeg(sheet.jpeg, 'test sheet');
    const tile = cropTile(image, { cols: sheet.cols, rows: sheet.rows }, 2);

    const bytes = encodeJpeg(tile);
    expect(bytes[0]).toBe(0xff); // SOI
    expect(bytes[1]).toBe(0xd8);

    const reread = decodeFilmstripJpeg(bytes, 'encoded tile');
    expect(reread.width).toBe(sheet.tileWidth);
    expect(reread.height).toBe(sheet.tileHeight);
    expectColourNear(centrePixel(reread), TILE_COLOURS[2]);
  });
});

describe('gridDividesExactly', () => {
  it('is true when the grid tiles the sheet evenly', () => {
    expect(
      gridDividesExactly({ width: 32000, height: 180 }, { cols: 100, rows: 1 })
    ).toBe(true);
  });

  it('is false on a remainder', () => {
    expect(
      gridDividesExactly({ width: 33, height: 8 }, { cols: 4, rows: 1 })
    ).toBe(false);
  });
});
