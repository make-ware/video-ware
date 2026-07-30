// Crop resolution and geometry. One rule shared by the webapp preview, the
// flattener (generate-tracks) and the CLI: a placement's effective crop is
// the clip's own rect if it stores a usable one, else the media's default,
// else nothing — and "usable but ~full-frame" resolves to nothing WITHOUT
// falling back, which is how a clip opts back into the full original frame
// over a media default. All rects are 0–1 fractions of the DISPLAY frame
// (post-rotation); see shared/src/types/crop.ts.

import {
  CROP_EPSILON,
  MIN_CROP_FRACTION,
  type CropRect,
} from '../types/crop.js';

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(n, lo), hi);

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Validate an untrusted crop value (a JSON column or meta key — PocketBase
 * returns `null` for empty JSON columns, and update() never re-validates).
 * Returns the rect clamped into [0,1] bounds, or undefined when malformed or
 * degenerate (a side below MIN_CROP_FRACTION after clamping). A ~full-frame
 * rect IS returned — full-frame is a valid *stored* value; whether it
 * becomes a no-op is resolveCropRect's decision.
 */
export function sanitizeCropRect(value: unknown): CropRect | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { left, top, width, height } = value as Record<string, unknown>;
  if (
    !isFiniteNumber(left) ||
    !isFiniteNumber(top) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return undefined;
  }

  const l = clamp(left, 0, 1);
  const t = clamp(top, 0, 1);
  const w = Math.min(clamp(width, 0, 1), 1 - l);
  const h = Math.min(clamp(height, 0, 1), 1 - t);
  if (w < MIN_CROP_FRACTION || h < MIN_CROP_FRACTION) return undefined;

  return { left: l, top: t, width: w, height: h };
}

/** True when the rect covers the whole frame within CROP_EPSILON. */
export function isFullFrameCrop(rect: CropRect): boolean {
  return (
    rect.left <= CROP_EPSILON &&
    rect.top <= CROP_EPSILON &&
    rect.width >= 1 - CROP_EPSILON &&
    rect.height >= 1 - CROP_EPSILON
  );
}

/**
 * Effective crop for a media-backed placement: the clip's rect if it stores
 * a valid one (including an explicit ~full-frame rect, which resolves to
 * undefined without falling back — the "show the full original" override),
 * else the media's default, else undefined (full frame). Invalid/degenerate
 * clip values are ignored and DO fall back to the media default.
 */
export function resolveCropRect(
  media: { crop?: CropRect | null } | null | undefined,
  clipMeta: { crop?: CropRect | null } | null | undefined
): CropRect | undefined {
  const chosen =
    sanitizeCropRect(clipMeta?.crop) ?? sanitizeCropRect(media?.crop);
  if (!chosen || isFullFrameCrop(chosen)) return undefined;
  return chosen;
}

/** Pixel-space crop window, ffmpeg `crop=width:height:x:y` argument order. */
export interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a normalized display-frame rect to integer pixels for ffmpeg's
 * crop filter. All four values round to EVEN integers — yuv420 chroma planes
 * are half-resolution, so odd offsets/sizes bleed chroma — width/height
 * floor at 2, and x/y clamp so the window stays inside the frame. Returns
 * undefined when the display dimensions are unknown (<= 0): the caller
 * renders uncropped rather than guessing geometry.
 */
export function cropRectToPixels(
  rect: CropRect,
  displayWidth: number,
  displayHeight: number
): PixelCropRect | undefined {
  if (
    !isFiniteNumber(displayWidth) ||
    !isFiniteNumber(displayHeight) ||
    displayWidth < 2 ||
    displayHeight < 2
  ) {
    return undefined;
  }

  const even = (n: number): number => Math.round(n / 2) * 2;
  // Frame bounds floor to even (never round up past an odd-sized frame), so
  // x + width can never escape it and stays even itself.
  const evenFloor = (n: number): number => Math.floor(n / 2) * 2;
  const maxWidth = evenFloor(displayWidth);
  const maxHeight = evenFloor(displayHeight);
  const width = clamp(even(rect.width * displayWidth), 2, maxWidth);
  const height = clamp(even(rect.height * displayHeight), 2, maxHeight);
  const x = clamp(even(rect.left * displayWidth), 0, maxWidth - width);
  const y = clamp(even(rect.top * displayHeight), 0, maxHeight - height);

  return { x, y, width, height };
}
