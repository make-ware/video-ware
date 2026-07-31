import { sanitizeCropRect, type CropRect } from '@project/shared';

/**
 * Pure UI model for the reframe editor: the user thinks in "aspect preset +
 * zoom + pan", storage thinks in a normalized display-frame rect. These
 * helpers convert both ways so the rect stays the single source of truth.
 */

export type CropPreset = 'original' | '9:16' | '1:1' | '4:5' | '16:9';

export const CROP_PRESETS: Array<{ key: CropPreset; label: string }> = [
  { key: '9:16', label: '9:16' },
  { key: '1:1', label: '1:1' },
  { key: '4:5', label: '4:5' },
  { key: '16:9', label: '16:9' },
  { key: 'original', label: 'Original' },
];

export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 8;

/** Relative tolerance for classifying a rect's aspect as a preset. */
const PRESET_ASPECT_TOLERANCE = 0.01;

const PRESET_RATIOS: Record<Exclude<CropPreset, 'original'>, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
};

/** Pixel aspect of the crop window a preset asks for. */
export function presetAspect(preset: CropPreset, mediaAspect: number): number {
  return preset === 'original' ? mediaAspect : PRESET_RATIOS[preset];
}

export interface CropEditorState {
  /** null = an aspect matching no preset ("Custom"). */
  preset: CropPreset | null;
  /** Pixel aspect of the crop window. */
  aspect: number;
  /** 1 = the largest window of the aspect; >1 zooms in. */
  zoom: number;
  /** Window center, 0–1 fractions of the display frame. */
  center: { x: number; y: number };
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(n, lo), hi);

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Rect for an aspect/zoom/center choice. The base window (zoom 1) is the
 * largest sub-rectangle of the requested pixel aspect that fits the frame;
 * zoom divides both sides; the center clamps so the window stays inside.
 */
export function deriveCropRect(opts: {
  mediaAspect: number;
  /** Pixel aspect of the crop window (from presetAspect). */
  aspect: number;
  zoom: number;
  center: { x: number; y: number };
}): CropRect {
  const { mediaAspect, aspect, center } = opts;
  const zoom = clamp(opts.zoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
  const width = Math.min(1, aspect / mediaAspect) / zoom;
  const height = Math.min(1, mediaAspect / aspect) / zoom;
  return {
    left: round4(clamp(center.x - width / 2, 0, 1 - width)),
    top: round4(clamp(center.y - height / 2, 0, 1 - height)),
    width: round4(width),
    height: round4(height),
  };
}

/**
 * Editor state for an existing rect — the inverse of deriveCropRect within
 * rounding. A rect whose aspect matches a preset (1% relative tolerance)
 * re-opens on that preset; anything else keeps its own aspect and reports
 * `preset: null` (rendered as "Custom").
 */
export function cropStateFromRect(
  rect: CropRect,
  mediaAspect: number
): CropEditorState {
  const aspect = (mediaAspect * rect.width) / rect.height;
  const baseWidth = Math.min(1, aspect / mediaAspect);
  const zoom = clamp(baseWidth / rect.width, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
  const center = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  let preset: CropPreset | null = null;
  if (relativeClose(aspect, mediaAspect)) {
    preset = 'original';
  } else {
    for (const [key, ratio] of Object.entries(PRESET_RATIOS)) {
      if (relativeClose(aspect, ratio)) {
        preset = key as CropPreset;
        break;
      }
    }
  }
  return { preset, aspect, zoom, center };
}

function relativeClose(a: number, b: number): boolean {
  return Math.abs(a - b) / b <= PRESET_ASPECT_TOLERANCE;
}

/**
 * Short human label for a stored rect ('9:16', 'Original', 'Custom').
 * Callers handle the no-rect case themselves ('Media crop' / 'Full frame').
 */
export function describeCrop(
  rect: CropRect | null | undefined,
  mediaAspect: number
): string {
  const valid = sanitizeCropRect(rect);
  if (!valid || !(mediaAspect > 0)) return 'Custom';
  const { preset } = cropStateFromRect(valid, mediaAspect);
  if (preset === 'original') return 'Original';
  return preset ?? 'Custom';
}
