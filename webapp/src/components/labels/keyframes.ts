import {
  tileFrameTime,
  tileIndexFor,
  type Bbox,
  type TileGeometry,
} from '@project/shared';

/**
 * The keyframe math itself lives in `@project/shared` — the CLI's `vw track`
 * reads it and the worker normalizers compute a track's union box from the same
 * arithmetic, so one copy beats three. Re-exported here so the label
 * components' import sites stay put.
 */
export {
  interpolateBbox,
  normalizeKeyframes,
  type Bbox,
  type Keyframe,
} from '@project/shared';

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

/**
 * The sprite-sheet tile math lives in `@project/shared` — the CLI's
 * `vw frame` needs the same arithmetic, and one copy beats three. Re-exported
 * here so the label components' import sites stay put.
 */
export { tileIndexFor, tileFrameTime, type TileGeometry };

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
