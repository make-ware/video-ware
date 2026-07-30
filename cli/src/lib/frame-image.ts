import { decode, encode } from 'jpeg-js';
import { tileRect } from '@project/shared';

/**
 * Pixel work for `vw frame`: decode a filmstrip sprite sheet, cut one tile out
 * of it, re-encode. jpeg-js is the only image dependency and it lives here —
 * pure JS with no native binary, which is what the single-file release bundle
 * (tsup.bundle.config.ts, which inlines every dependency) can actually ship.
 *
 * No PocketBase, no filesystem: everything in this module is a pure function
 * over bytes.
 */

/** Decoded RGBA pixels, jpeg-js's `useTArray` shape. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Re-encode quality. jpeg-js defaults to 50, which visibly mushes an already
 * lossy 320px sprite tile — always pass this.
 */
export const FRAME_JPEG_QUALITY = 90;

/**
 * Decode ceilings. A 100-tile sheet of 320x180 tiles is 32000x180 = 5.76 MP,
 * about 23 MB of RGBA. The headroom above that is for a future larger
 * `tileWidth`; the point of setting them at all is that a corrupt or hostile
 * JPEG fails loudly instead of exhausting memory.
 */
const DECODE_LIMITS = {
  useTArray: true,
  maxResolutionInMP: 200,
  maxMemoryUsageInMB: 1024,
} as const;

/** Decode a filmstrip sheet to RGBA. `subject` names it in failures. */
export function decodeFilmstripJpeg(
  bytes: Uint8Array,
  subject: string
): RgbaImage {
  try {
    const { width, height, data } = decode(bytes, DECODE_LIMITS);
    return { width, height, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not decode ${subject}: ${message}`);
  }
}

/**
 * Copy one tile out of a decoded sheet.
 *
 * Tile geometry comes from `tileRect`, i.e. from the sheet's real decoded
 * dimensions — never from `meta.filmstripConfig.tileWidth/tileHeight`. Those
 * are the values the transcode step was *asked* for: the ffmpeg executor
 * recomputes tile height from the source aspect ratio and the processor stores
 * the request anyway, so for non-16:9 (and rotated) media the stored size
 * disagrees with the image.
 */
export function cropTile(
  image: RgbaImage,
  grid: { cols: number; rows: number },
  tileIndex: number
): RgbaImage {
  const rect = tileRect(grid, image, tileIndex);
  const rowBytes = rect.width * 4;
  const data = new Uint8Array(rowBytes * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * image.width + rect.x) * 4;
    data.set(image.data.subarray(from, from + rowBytes), y * rowBytes);
  }
  return { width: rect.width, height: rect.height, data };
}

/** Encode RGBA pixels as a JPEG. */
export function encodeJpeg(
  image: RgbaImage,
  quality: number = FRAME_JPEG_QUALITY
): Buffer {
  return Buffer.from(encode(image, quality).data);
}

/**
 * Whether the grid divides the sheet exactly. ffmpeg's `tile` filter always
 * emits `cols * tileWidth` by `rows * tileHeight`, so a remainder means the
 * stored `cols`/`rows` disagree with the image — worth a warning, not a
 * failure, since flooring still lands inside the right tile.
 */
export function gridDividesExactly(
  image: { width: number; height: number },
  grid: { cols: number; rows: number }
): boolean {
  return image.width % grid.cols === 0 && image.height % grid.rows === 0;
}
