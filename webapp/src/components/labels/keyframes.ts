import type { LabelTrack } from '@project/shared';

/** Normalized bounding box, all coords 0–1 fractions of the frame. */
export interface Bbox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Keyframe {
  /** Seconds — absolute media time in storage, track-relative once normalized. */
  t: number;
  bbox: Bbox;
  confidence?: number;
}

/**
 * A track's keyframes as a clean, sorted, track-relative list: malformed
 * entries dropped, absolute times converted to offsets from trackStart.
 */
export function normalizeKeyframes(
  raw: LabelTrack['keyframes'],
  trackStart: number
): Keyframe[] {
  const list = Array.isArray(raw) ? (raw as unknown as Keyframe[]) : [];
  return list
    .filter(
      (kf) =>
        kf &&
        typeof kf.t === 'number' &&
        kf.bbox &&
        typeof kf.bbox.left === 'number' &&
        typeof kf.bbox.top === 'number' &&
        typeof kf.bbox.right === 'number' &&
        typeof kf.bbox.bottom === 'number'
    )
    .map((kf) => ({ ...kf, t: kf.t - trackStart }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Bounding box at a track-relative time, linearly interpolated between the
 * surrounding keyframes. Outside the keyframe range the nearest keyframe's
 * box is held so the overlay never blinks out mid-track; a degenerate
 * interpolation result falls back to the previous keyframe.
 */
export function interpolateBbox(
  sorted: Keyframe[],
  relativeTime: number
): Bbox | null {
  if (sorted.length === 0) return null;

  let prevIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].t <= relativeTime) prevIdx = i;
    else break;
  }
  if (prevIdx === -1) return sorted[0].bbox;

  const prev = sorted[prevIdx];
  const next = sorted[prevIdx + 1];
  if (!next) return prev.bbox;

  const dt = next.t - prev.t;
  if (dt <= 0 || !isFinite(dt)) return prev.bbox;

  const f = Math.max(0, Math.min(1, (relativeTime - prev.t) / dt));
  const box = {
    left: prev.bbox.left + (next.bbox.left - prev.bbox.left) * f,
    top: prev.bbox.top + (next.bbox.top - prev.bbox.top) * f,
    right: prev.bbox.right + (next.bbox.right - prev.bbox.right) * f,
    bottom: prev.bbox.bottom + (next.bbox.bottom - prev.bbox.bottom) * f,
  };
  if (
    !isFinite(box.left) ||
    !isFinite(box.top) ||
    !isFinite(box.right) ||
    !isFinite(box.bottom) ||
    box.right <= box.left ||
    box.bottom <= box.top
  ) {
    return prev.bbox;
  }
  return box;
}

/** Sub-rectangle of a frame, all values 0–1 fractions of the frame. */
export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Expand a bbox into a padded crop region whose *display* aspect
 * (frameAspect = displayed frame width/height) matches `displayAspect` —
 * square by default — so the crop fills a thumbnail of that shape without
 * distorting the subject. Clamped inside the frame; when the padded region
 * exceeds a frame dimension that axis covers the whole frame instead.
 */
export function bboxCropRegion(
  bbox: Bbox,
  frameAspect: number,
  displayAspect = 1,
  padFraction = 0.25
): CropRegion | null {
  const w = bbox.right - bbox.left;
  const h = bbox.bottom - bbox.top;
  if (!(w > 0) || !(h > 0) || !isFinite(w) || !isFinite(h)) return null;

  const aspect =
    frameAspect > 0 && isFinite(frameAspect) ? frameAspect : 16 / 9;
  const target =
    displayAspect > 0 && isFinite(displayAspect) ? displayAspect : 1;
  // Display height (fraction of frame height) covering the bbox on both
  // display axes, padded; width follows from the target display aspect.
  const side = Math.max((w * aspect) / target, h) * (1 + 2 * padFraction);
  const width = Math.min((side * target) / aspect, 1);
  const height = Math.min(side, 1);
  const cx = (bbox.left + bbox.right) / 2;
  const cy = (bbox.top + bbox.bottom) / 2;
  return {
    left: Math.min(Math.max(cx - width / 2, 0), 1 - width),
    top: Math.min(Math.max(cy - height / 2, 0), 1 - height),
    width,
    height,
  };
}

/** The sprite-sheet geometry needed to locate a tile (FilmstripConfig subset). */
export interface TileGeometry {
  cols: number;
  rows: number;
  fps: number;
  startTime: number;
}

/** Index of the sprite tile FilmstripViewer would show for `time`. */
export function tileIndexFor(config: TileGeometry, time: number): number {
  const local = Math.max(0, time - config.startTime);
  const total = config.cols * config.rows;
  return Math.min(Math.max(Math.floor(local * config.fps), 0), total - 1);
}

/** Media timestamp of the frame captured in the tile shown for `time`. */
export function tileFrameTime(config: TileGeometry, time: number): number {
  return config.startTime + tileIndexFor(config, time) / config.fps;
}

/**
 * CSS background-size/-position (percentages) rendering only `region` of the
 * sprite tile for `time` — the bbox-crop analog of FilmstripViewer's
 * full-tile math (region {0,0,1,1} reproduces it exactly).
 */
export function cropBackground(
  config: TileGeometry,
  time: number,
  region: CropRegion
): { backgroundSize: string; backgroundPosition: string } {
  const idx = tileIndexFor(config, time);
  const col = idx % config.cols;
  const row = Math.floor(idx / config.cols);

  // background-position P% aligns the P% point of the image with the P% point
  // of the container, so the offset that puts the region's edge at 0 is
  // (tile + regionEdge) / (tiles - regionSpan).
  const denomX = config.cols - region.width;
  const denomY = config.rows - region.height;
  const posX = denomX > 0 ? ((col + region.left) / denomX) * 100 : 0;
  const posY = denomY > 0 ? ((row + region.top) / denomY) * 100 : 0;

  return {
    backgroundSize: `${(config.cols / region.width) * 100}% ${(config.rows / region.height) * 100}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
}
