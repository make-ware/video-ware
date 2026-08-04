/**
 * Keyframe math for `LabelTrack.keyframes` — the per-frame tracking geometry.
 *
 * This is the one copy shared by all three surfaces: the webapp's bbox overlay
 * and crop thumbnails, the CLI's `vw track` reads, and the worker normalizers
 * that compute a track's union box on the write side. Everything here is pure
 * arithmetic over plain objects, so it stays browser-safe and lives in the main
 * `@project/shared` entrypoint.
 *
 * ## Storage contract
 *
 * A keyframe is `{ t, bbox: { left, top, right, bottom }, confidence }` where
 * every coordinate is a **0–1 fraction of the frame** and `t` is **absolute
 * media seconds** — `keyframes[0].t === track.start` and the last entry's `t`
 * is `track.end`. (The schema's original doc comment described
 * `timeOffset`/`boundingBox` keys; those were never what the normalizers wrote.)
 *
 * Two label kinds store `keyframes: []` on purpose — speech and speaker tracks
 * have no spatial data at all — so an empty list is a valid track, not a
 * missing one. Every function here returns an empty/null result rather than
 * throwing for that case.
 *
 * Precision differs by provider: object and text keyframes are rounded to 4
 * decimals at normalization time, while face and person keyframes are stored as
 * raw float64. `roundKeyframe` exists so a reader can flatten that difference.
 */

/** Normalized bounding box, all coords 0–1 fractions of the frame. */
export interface Bbox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One sampled frame of a track. */
export interface Keyframe {
  /** Seconds — absolute media time in storage, track-relative once rebased. */
  t: number;
  bbox: Bbox;
  confidence?: number;
  /** Provider extras (face attributes, person landmarks). Passed through. */
  attributes?: Record<string, unknown>;
  landmarks?: unknown;
}

/** A finite number, or undefined. */
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Whether a value has the shape of a stored keyframe. */
function isKeyframe(value: unknown): value is Keyframe {
  if (!value || typeof value !== 'object') return false;
  const kf = value as Keyframe;
  return (
    finite(kf.t) &&
    !!kf.bbox &&
    typeof kf.bbox === 'object' &&
    finite(kf.bbox.left) &&
    finite(kf.bbox.top) &&
    finite(kf.bbox.right) &&
    finite(kf.bbox.bottom)
  );
}

/**
 * A track's keyframes as a clean, sorted list: malformed entries dropped,
 * times shifted by `trackStart`.
 *
 * `trackStart` defaults to 0, which makes this the plain parser for readers
 * that want the stored absolute media times (the CLI's default). Pass
 * `track.start` to get the track-relative offsets the webapp's animation clock
 * runs on.
 */
export function normalizeKeyframes(raw: unknown, trackStart = 0): Keyframe[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter(isKeyframe)
    .map((kf) => ({ ...kf, t: kf.t - trackStart }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Bounding box at a time, linearly interpolated between the surrounding
 * keyframes. Outside the keyframe range the nearest keyframe's box is held so
 * the overlay never blinks out mid-track; a degenerate interpolation result
 * falls back to the previous keyframe.
 *
 * `time` must be in the same base as the keyframes — absolute media seconds
 * for a list from `normalizeKeyframes(raw)`, track-relative for one from
 * `normalizeKeyframes(raw, track.start)`.
 */
export function interpolateBbox(sorted: Keyframe[], time: number): Bbox | null {
  if (sorted.length === 0) return null;

  let prevIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].t <= time) prevIdx = i;
    else break;
  }
  if (prevIdx === -1) return sorted[0].bbox;

  const prev = sorted[prevIdx];
  const next = sorted[prevIdx + 1];
  if (!next) return prev.bbox;

  const dt = next.t - prev.t;
  if (dt <= 0 || !Number.isFinite(dt)) return prev.bbox;

  const f = Math.max(0, Math.min(1, (time - prev.t) / dt));
  const box = {
    left: prev.bbox.left + (next.bbox.left - prev.bbox.left) * f,
    top: prev.bbox.top + (next.bbox.top - prev.bbox.top) * f,
    right: prev.bbox.right + (next.bbox.right - prev.bbox.right) * f,
    bottom: prev.bbox.bottom + (next.bbox.bottom - prev.bbox.bottom) * f,
  };
  if (
    !Number.isFinite(box.left) ||
    !Number.isFinite(box.top) ||
    !Number.isFinite(box.right) ||
    !Number.isFinite(box.bottom) ||
    box.right <= box.left ||
    box.bottom <= box.top
  ) {
    return prev.bbox;
  }
  return box;
}

/**
 * The box covering every keyframe of a track — what `LabelTrack.boundingBox`
 * holds. Answers "did anything move in the top-right corner" without parsing
 * the keyframes array, so it is computed once on the write side and used as a
 * cheap spatial filter on the read side.
 *
 * Returns null for a track with no spatial keyframes (speech/speaker), which is
 * exactly the case where the column should stay empty.
 */
export function unionBbox(keyframes: readonly Keyframe[]): Bbox | null {
  let box: Bbox | null = null;
  for (const kf of keyframes) {
    if (!isKeyframe(kf)) continue;
    box = box
      ? {
          left: Math.min(box.left, kf.bbox.left),
          top: Math.min(box.top, kf.bbox.top),
          right: Math.max(box.right, kf.bbox.right),
          bottom: Math.max(box.bottom, kf.bbox.bottom),
        }
      : { ...kf.bbox };
  }
  return box;
}

/**
 * Up to `maxSamples` keyframes, spread evenly across the list.
 *
 * Index-uniform rather than time-uniform: keyframes arrive at a fixed provider
 * cadence, so the two agree, and picking by index can never return the same
 * frame twice. Always keeps the first and last frame so a sampled preview still
 * shows where the track started and ended.
 */
export function sampleKeyframes(
  keyframes: readonly Keyframe[],
  maxSamples: number
): Keyframe[] {
  if (maxSamples < 1) return [];
  if (keyframes.length <= maxSamples) return [...keyframes];
  if (maxSamples === 1) return [keyframes[0]];

  const last = keyframes.length - 1;
  const step = last / (maxSamples - 1);
  const picked: Keyframe[] = [];
  let previous = -1;
  for (let i = 0; i < maxSamples; i++) {
    const index = Math.min(last, Math.round(i * step));
    if (index === previous) continue;
    previous = index;
    picked.push(keyframes[index]);
  }
  return picked;
}

/**
 * Thin a sorted keyframe list to at most one frame per `everySeconds`.
 *
 * Keeps the first frame, then each frame at least `everySeconds` after the last
 * kept one, plus the final frame so the track's end is never lost. A step of 0
 * or less is a no-op, so callers can pass an unset flag straight through.
 */
export function decimateKeyframes(
  keyframes: readonly Keyframe[],
  everySeconds: number
): Keyframe[] {
  if (!(everySeconds > 0) || keyframes.length <= 2) return [...keyframes];

  const kept: Keyframe[] = [];
  let lastT = -Infinity;
  for (const kf of keyframes) {
    if (kf.t - lastT >= everySeconds) {
      kept.push(kf);
      lastT = kf.t;
    }
  }
  const final = keyframes[keyframes.length - 1];
  if (kept[kept.length - 1] !== final) kept.push(final);
  return kept;
}

/** Round a number to `digits` decimals, dropping trailing zeros. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * A keyframe with its geometry rounded to `digits` decimals.
 *
 * Object and text keyframes are already stored at 4 decimals; face and person
 * keyframes carry raw float64, roughly doubling their serialized size for
 * precision no consumer uses. `t` is left alone — it is a provider-supplied
 * frame time, and rounding it could collide two frames onto one timestamp.
 */
export function roundKeyframe(kf: Keyframe, digits: number): Keyframe {
  if (!Number.isInteger(digits) || digits < 0) return kf;
  return {
    ...kf,
    bbox: {
      left: round(kf.bbox.left, digits),
      top: round(kf.bbox.top, digits),
      right: round(kf.bbox.right, digits),
      bottom: round(kf.bbox.bottom, digits),
    },
    ...(finite(kf.confidence)
      ? { confidence: round(kf.confidence, digits) }
      : {}),
  };
}

/** A bbox in whole pixels of a `width`×`height` frame. */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Convert a normalized box to pixels of a frame.
 *
 * Callers should size the frame with `mediaDisplayDimensions`, not the Media
 * row's coded `width`/`height` — rotated phone footage reports its pre-rotation
 * geometry there. Returns null for a frame with no usable dimensions.
 */
export function bboxToPixels(
  bbox: Bbox,
  frameWidth: number,
  frameHeight: number
): PixelBox | null {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return null;
  const left = Math.round(bbox.left * frameWidth);
  const top = Math.round(bbox.top * frameHeight);
  const right = Math.round(bbox.right * frameWidth);
  const bottom = Math.round(bbox.bottom * frameHeight);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/** Fraction of the frame a box covers (0–1). Negative extents read as 0. */
export function bboxArea(bbox: Bbox): number {
  const width = Math.max(0, bbox.right - bbox.left);
  const height = Math.max(0, bbox.bottom - bbox.top);
  return width * height;
}

/** Centre point of a box, in the same 0–1 space. */
export function bboxCenter(bbox: Bbox): { x: number; y: number } {
  return {
    x: (bbox.left + bbox.right) / 2,
    y: (bbox.top + bbox.bottom) / 2,
  };
}

/** Whether two boxes share any area. Touching edges do not count. */
export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
