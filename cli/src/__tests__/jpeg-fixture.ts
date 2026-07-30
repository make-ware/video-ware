import { encode } from 'jpeg-js';

/**
 * Synthesize a filmstrip sprite sheet: `cols` flat-coloured tiles side by side,
 * encoded as a real JPEG. The frame pipeline is tested against these rather
 * than a checked-in fixture — a genuine encode/decode round trip, so the crop
 * math is exercised on real entropy-coded bytes.
 *
 * Colours are spread apart in luma and chroma so 4:2:0 subsampling at a tile
 * boundary cannot bleed one into the next at the sampled centre pixel.
 */
export const TILE_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [200, 30, 40],
  [30, 200, 40],
  [40, 30, 200],
  [220, 220, 30],
];

export interface SpriteFixture {
  jpeg: Buffer;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export function makeSpriteSheet(
  opts: { cols?: number; tileWidth?: number; tileHeight?: number } = {}
): SpriteFixture {
  const cols = opts.cols ?? TILE_COLOURS.length;
  const tileWidth = opts.tileWidth ?? 16;
  const tileHeight = opts.tileHeight ?? 16;
  const width = cols * tileWidth;
  const data = new Uint8Array(width * tileHeight * 4);

  for (let y = 0; y < tileHeight; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] =
        TILE_COLOURS[Math.floor(x / tileWidth) % TILE_COLOURS.length];
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  return {
    jpeg: Buffer.from(encode({ width, height: tileHeight, data }, 100).data),
    cols,
    rows: 1,
    tileWidth,
    tileHeight,
  };
}

/** The RGB at the centre of a decoded tile. */
export function centrePixel(image: {
  width: number;
  height: number;
  data: Uint8Array;
}): [number, number, number] {
  const i = ((image.height >> 1) * image.width + (image.width >> 1)) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}
