// Autocrop aggregation and the apply/skip decision, shared by the ingest
// AUTOCROP step and its tests. Everything here is pure: the worker owns
// running ffmpeg `cropdetect` and parsing its stderr, this module owns what
// the resulting boxes MEAN.
//
// Two rules drive the design:
//   1. Aggregation is a UNION, never an average or an intersection. The union
//      of every sampled box is a superset of all of them, so the recommended
//      crop can never cut content that was visible in any sample. Sampling
//      more of the media can only ever loosen the crop, never tighten it past
//      real picture.
//   2. The detector only ever overwrites a crop it OWNS. A crop a human set
//      (or one that no longer matches the previous suggestion) wins over the
//      detector, so a re-ingest can't silently re-frame someone's edit.

import {
  CROP_EPSILON,
  FULL_FRAME_CROP,
  type CropRect,
  type CropSuggestion,
  type CropSuggestionSkipReason,
} from '../types/crop.js';
import {
  isFullFrameCrop,
  sanitizeCropRect,
  type PixelCropRect,
} from './crop.js';

/** A cropdetect window in DISPLAY pixels (ffmpeg `crop=w:h:x:y` geometry). */
export type CropBox = PixelCropRect;

export interface AutoCropThresholds {
  /**
   * Minimum fraction of a side the box must trim before it counts as a real
   * border. Below this the "crop" is encoder noise on the frame edge, and
   * applying it would only cost a re-encode of the outermost pixels.
   */
  minTrimFraction: number;
  /**
   * Reject a box covering less than this fraction of the frame area. A mostly
   * dark shot (night footage, a fade) makes cropdetect converge on the one lit
   * region, and trusting that would throw away most of the picture.
   */
  minAreaFraction: number;
}

export const AUTOCROP_THRESHOLD_DEFAULTS: AutoCropThresholds = {
  minTrimFraction: 0.015,
  minAreaFraction: 0.25,
};

const isPositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/** True when two rects match on all four edges within CROP_EPSILON. */
export function cropRectsEqual(a: CropRect, b: CropRect): boolean {
  return (
    Math.abs(a.left - b.left) <= CROP_EPSILON &&
    Math.abs(a.top - b.top) <= CROP_EPSILON &&
    Math.abs(a.width - b.width) <= CROP_EPSILON &&
    Math.abs(a.height - b.height) <= CROP_EPSILON
  );
}

/**
 * Boxes that actually bound something. cropdetect emits a non-positive box
 * for an all-black window, where it had no content to bound — those say
 * nothing about the crop and must not be counted as samples either.
 */
export function usableCropBoxes(boxes: CropBox[]): CropBox[] {
  return boxes.filter(
    (b) =>
      isPositive(b.width) &&
      isPositive(b.height) &&
      Number.isFinite(b.x) &&
      Number.isFinite(b.y) &&
      b.x >= 0 &&
      b.y >= 0
  );
}

/** Smallest box containing every usable input box — the safe aggregate (rule 1). */
export function unionCropBoxes(boxes: CropBox[]): CropBox | undefined {
  const usable = usableCropBoxes(boxes);
  if (usable.length === 0) return undefined;

  const left = Math.min(...usable.map((b) => b.x));
  const top = Math.min(...usable.map((b) => b.y));
  const right = Math.max(...usable.map((b) => b.x + b.width));
  const bottom = Math.max(...usable.map((b) => b.y + b.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Per-sample edge tolerance for the agreement figure. cropdetect rounds its
 * box (`round=2` here) and compression noise moves a border by a pixel or
 * two, so exact equality would report disagreement on identical footage.
 */
export function cropBoxTolerance(
  displayWidth: number,
  displayHeight: number
): number {
  return Math.max(2, Math.round(0.01 * Math.min(displayWidth, displayHeight)));
}

/**
 * Fraction of boxes matching `union` on all four edges within `tolerance`.
 * Reported on the suggestion for diagnosis only — it is deliberately NOT a
 * gate, because the union is already the conservative answer.
 */
export function cropBoxAgreement(
  boxes: CropBox[],
  union: CropBox,
  tolerance: number
): number {
  if (boxes.length === 0) return 0;
  const matches = boxes.filter(
    (b) =>
      Math.abs(b.x - union.x) <= tolerance &&
      Math.abs(b.y - union.y) <= tolerance &&
      Math.abs(b.x + b.width - (union.x + union.width)) <= tolerance &&
      Math.abs(b.y + b.height - (union.y + union.height)) <= tolerance
  );
  return matches.length / boxes.length;
}

/**
 * Pixel box → display-frame fractions. Runs through `sanitizeCropRect`, so the
 * result is clamped into bounds and `undefined` when degenerate — the same
 * validity rule every other crop consumer uses.
 */
export function cropBoxToRect(
  box: CropBox,
  displayWidth: number,
  displayHeight: number
): CropRect | undefined {
  if (!isPositive(displayWidth) || !isPositive(displayHeight)) return undefined;
  return sanitizeCropRect({
    left: box.x / displayWidth,
    top: box.y / displayHeight,
    width: box.width / displayWidth,
    height: box.height / displayHeight,
  });
}

/**
 * Whether the detector may overwrite the media's current crop (rule 2).
 *
 * It owns the column when nothing is stored, when what is stored is a
 * ~full-frame no-op (carries no framing intent), or when the stored rect is
 * still exactly the rect a previous run applied. Anything else is a human's
 * framing — or drift the detector cannot explain — and is left alone.
 */
export function autoCropOwnsCrop(
  existingCrop: CropRect | undefined,
  previous: CropSuggestion | null | undefined
): boolean {
  if (!existingCrop) return true;
  if (isFullFrameCrop(existingCrop)) return true;
  if (!previous?.applied) return false;
  return cropRectsEqual(existingCrop, previous.rect);
}

export interface AutoCropDecision {
  /**
   * Rect to write to `Media.crop`. `undefined` leaves the column untouched —
   * which is NOT the same as writing a full-frame rect (that actively resets
   * a crop this detector previously applied).
   */
  crop?: CropRect;
  /** True when the recommendation itself was applied to the media. */
  applied: boolean;
  /** Present exactly when `applied` is false. */
  skipReason?: CropSuggestionSkipReason;
}

/**
 * Decide what a detected rect does to `Media.crop`.
 *
 * The one non-obvious outcome is the reset: when the detector owns the crop
 * and now finds nothing worth cropping, it writes the full frame back rather
 * than leaving a stale border in place. A re-ingest of re-encoded source
 * therefore un-crops itself, while a manual crop survives untouched.
 */
export function decideAutoCrop(params: {
  /** Aggregated recommendation, display-frame fractions. */
  rect: CropRect;
  /** Current `Media.crop`, already sanitized (undefined when unset/invalid). */
  existingCrop?: CropRect;
  /** Current `Media.cropSuggestion`, used only to establish ownership. */
  previous?: CropSuggestion | null;
  thresholds?: Partial<AutoCropThresholds>;
}): AutoCropDecision {
  const { rect, existingCrop, previous } = params;
  const { minTrimFraction, minAreaFraction } = {
    ...AUTOCROP_THRESHOLD_DEFAULTS,
    ...params.thresholds,
  };

  if (rect.width * rect.height < minAreaFraction) {
    return { applied: false, skipReason: 'unreliable' };
  }

  if (!autoCropOwnsCrop(existingCrop, previous)) {
    return { applied: false, skipReason: 'manual-crop' };
  }

  const full = isFullFrameCrop(rect);
  const largestTrim = Math.max(1 - rect.width, 1 - rect.height);
  if (full || largestTrim < minTrimFraction) {
    const staleCrop =
      existingCrop !== undefined && !isFullFrameCrop(existingCrop);
    return {
      crop: staleCrop ? FULL_FRAME_CROP : undefined,
      applied: false,
      skipReason: full ? 'full-frame' : 'below-threshold',
    };
  }

  return { crop: rect, applied: true };
}
