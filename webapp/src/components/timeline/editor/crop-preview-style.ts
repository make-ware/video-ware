import type { CropRect } from '@project/shared';

/**
 * Pure CSS geometry for cropped playback in the preview stage.
 *
 * The render pipeline crops the source and then letterboxes the CROPPED
 * region into the canvas (`crop=…,scale=W:H:force_original_aspect_ratio=
 * decrease,pad=…`). The preview mirrors that with two nested boxes, all in
 * percentages so nothing has to be measured:
 *
 * - `frame` — an overflow-hidden wrapper positioned inside the stage as the
 *   contain-box of the cropped region (what the pad filter does).
 * - `video` — the <video> element oversized inside the wrapper so exactly
 *   the crop window fills it: width 100/rectW %, offset -(left/rectW)·100 %.
 *   The resulting element box has exactly the media's display aspect, so the
 *   element's `object-contain` never letterboxes when cropping is active.
 *
 * The stage aspect is statically known (timeline orientation), which is why
 * this can be percentage math instead of CSS `aspect-ratio` (unreliable on
 * absolutely-positioned boxes) or ResizeObserver measurement.
 *
 * Unknown geometry degrades to the uncropped passthrough — a wrong guess
 * would misplace the window, while full-frame merely shows the bars.
 */

export interface CropPreviewBoxStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

export interface CropPreviewStyle {
  /** Styles for the overflow-hidden wrapper (relative to the stage). */
  frame: CropPreviewBoxStyle;
  /** Styles for the <video> element (relative to the wrapper). */
  video: CropPreviewBoxStyle;
  /** Stable identity — apply styles only when this changes. */
  key: string;
}

/** Percentage box (0–100) of `inner` contain-fitted and centered in `outer`. */
export function containBox(
  outerAspect: number,
  innerAspect: number
): { left: number; top: number; width: number; height: number } {
  const width =
    innerAspect >= outerAspect ? 100 : (innerAspect / outerAspect) * 100;
  const height =
    innerAspect >= outerAspect ? (outerAspect / innerAspect) * 100 : 100;
  return { left: (100 - width) / 2, top: (100 - height) / 2, width, height };
}

const pct = (n: number): string => `${Math.round(n * 10000) / 10000}%`;

const PASSTHROUGH_BOX: CropPreviewBoxStyle = {
  left: '0%',
  top: '0%',
  width: '100%',
  height: '100%',
};

const PASSTHROUGH: CropPreviewStyle = {
  frame: PASSTHROUGH_BOX,
  video: PASSTHROUGH_BOX,
  key: 'full',
};

export function cropPreviewStyle(opts: {
  /** Stage box aspect from the timeline orientation (16/9 or 9/16). */
  stageAspect: number;
  /**
   * Media display aspect (rotation-corrected, mediaDisplayDimensions). Pass
   * 0 for unknown — unknown degrades to the uncropped passthrough.
   */
  mediaAspect: number;
  /** Effective crop (resolveCropRect); null/undefined = full frame. */
  rect: CropRect | null | undefined;
}): CropPreviewStyle {
  const { stageAspect, mediaAspect, rect } = opts;
  if (
    !rect ||
    !Number.isFinite(stageAspect) ||
    stageAspect <= 0 ||
    !Number.isFinite(mediaAspect) ||
    mediaAspect <= 0 ||
    !(rect.width > 0) ||
    !(rect.height > 0)
  ) {
    return PASSTHROUGH;
  }

  const croppedAspect = (mediaAspect * rect.width) / rect.height;
  const frame = containBox(stageAspect, croppedAspect);

  return {
    frame: {
      left: pct(frame.left),
      top: pct(frame.top),
      width: pct(frame.width),
      height: pct(frame.height),
    },
    video: {
      left: pct((-rect.left / rect.width) * 100),
      top: pct((-rect.top / rect.height) * 100),
      width: pct((1 / rect.width) * 100),
      height: pct((1 / rect.height) * 100),
    },
    key: `${stageAspect}:${mediaAspect}:${rect.left},${rect.top},${rect.width},${rect.height}`,
  };
}
