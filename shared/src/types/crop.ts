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

/** The whole frame — the rect that means "nothing to crop". */
export const FULL_FRAME_CROP: CropRect = {
  left: 0,
  top: 0,
  width: 1,
  height: 1,
};

/**
 * Why an autocrop recommendation was NOT written to `Media.crop`.
 * - `full-frame` — cropdetect found content out to every edge; nothing to trim.
 * - `below-threshold` — a real box, but it trims less than `minTrimFraction`
 *   of every side, i.e. encoder noise rather than a burned-in border.
 * - `unreliable` — the box covers implausibly little of the frame (a mostly
 *   dark source fools cropdetect); trusting it would throw away picture.
 * - `manual-crop` — the media already carries a crop this detector does not
 *   own, so a human's framing wins.
 */
export type CropSuggestionSkipReason =
  'full-frame' | 'below-threshold' | 'unreliable' | 'manual-crop';

/**
 * An ffmpeg `cropdetect` recommendation, stored on `Media.cropSuggestion` by
 * the ingest AUTOCROP step.
 *
 * The record is written on EVERY detection, applied or not — it is the audit
 * trail that explains what `Media.crop` holds (and why it holds nothing).
 * `rect` is display-frame fractions, exactly like `Media.crop`; `pixels` keeps
 * the raw window cropdetect converged on so a suggestion stays interpretable
 * after the fact.
 */
export interface CropSuggestion {
  /** Recommended crop in display-frame fractions; full-frame = nothing to do. */
  rect: CropRect;
  /** Raw cropdetect window, DISPLAY pixels (ffmpeg `crop=w:h:x:y` geometry). */
  pixels: { x: number; y: number; width: number; height: number };
  /** Display frame the pixels were measured against (post-rotation). */
  displayWidth: number;
  displayHeight: number;
  /** Sample windows that produced a usable box, and how many were attempted. */
  samples: number;
  attempted: number;
  /**
   * Fraction of usable samples whose box matched the union on all four edges.
   * Informational only — the union is a superset, so it never over-crops and
   * disagreement is not a reason to reject (see utils/autocrop.ts).
   */
  agreement: number;
  /** True when this recommendation was written to `Media.crop`. */
  applied: boolean;
  /** Present exactly when `applied` is false. */
  skipReason?: CropSuggestionSkipReason;
  /** cropdetect `limit` (0–255 black threshold) used for the detection. */
  limit: number;
  /** ISO timestamp of the detection run. */
  detectedAt: string;
}

export const CropSuggestionSchema = z.object({
  rect: CropRectSchema,
  pixels: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  displayWidth: z.number(),
  displayHeight: z.number(),
  samples: z.number(),
  attempted: z.number(),
  agreement: z.number().min(0).max(1),
  applied: z.boolean(),
  skipReason: z
    .enum(['full-frame', 'below-threshold', 'unreliable', 'manual-crop'])
    .optional(),
  limit: z.number(),
  detectedAt: z.string(),
}) satisfies z.ZodType<CropSuggestion>;
