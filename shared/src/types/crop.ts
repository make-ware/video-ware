import { z } from 'zod';

/**
 * Sub-rectangle of a media frame, all values 0–1 fractions of the DISPLAY
 * frame — the post-rotation frame that ffmpeg (autorotate, on by default)
 * and every browser decode to, NOT the coded dimensions stored on
 * `Media.width/height` (see shared/src/utils/media-dimensions.ts).
 *
 * Stored in two places with one resolution rule (utils/crop.ts):
 * - `Media.crop` — the default source crop for every placement (e.g. strip
 *   burned-in letterbox bars).
 * - `TimelineClip.meta.crop` — a per-placement reframe that overrides the
 *   media default. Absolute display-space values, not relative to the
 *   media crop; delete the key to reset to the default.
 *
 * Mirrors the webapp's label-thumbnail `CropRegion` shape
 * (webapp/src/components/labels/keyframes.ts).
 */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Sides smaller than this fraction are degenerate (caps zoom at ~100x). */
export const MIN_CROP_FRACTION = 0.01;

/** Tolerance for float noise in bounds checks and full-frame detection. */
export const CROP_EPSILON = 0.001;

export const CropRectSchema = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    width: z.number().min(MIN_CROP_FRACTION).max(1),
    height: z.number().min(MIN_CROP_FRACTION).max(1),
  })
  .refine((r) => r.left + r.width <= 1 + CROP_EPSILON, {
    message: 'crop extends past the right edge (left + width > 1)',
    path: ['width'],
  })
  .refine((r) => r.top + r.height <= 1 + CROP_EPSILON, {
    message: 'crop extends past the bottom edge (top + height > 1)',
    path: ['height'],
  }) satisfies z.ZodType<CropRect>;
