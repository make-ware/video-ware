/**
 * Pure geometry for the editor's preview ⇄ timeline split.
 *
 * Kept out of `TimelineEditorLayout` so the vertical budget is unit-testable:
 * every number below is exercised by `__tests__/timeline-split.test.ts`.
 *
 * All heights are measured against the *player+timeline column* — the flex
 * child holding the preview, the splitter and the timeline pane — not against
 * `window.innerHeight`. On a phone those differ by ~140px (nav + toolbar +
 * bottom bar), which is why a `window`-relative clamp used to leave the preview
 * with ~40px.
 */

export const TIMELINE_HEIGHT_KEY = 'timeline-editor:timeline-height';

/** Desktop's opening split. Phones derive their own — see below. */
export const DEFAULT_TIMELINE_HEIGHT = 320;
export const MIN_TIMELINE_HEIGHT = 180;

/** The splitter is `h-6` on phones and `h-2.5` at lg; clamp with the larger. */
export const SPLITTER_HEIGHT = 24;

/** Below this the preview is decorative, so the timeline may not grow past it. */
export const MIN_PLAYER_HEIGHT = 160;

/**
 * Everything in the player area that is not the preview stage: the transport
 * row (40), the flex gap (4) and the area's own `p-1` padding (8).
 */
export const PLAYER_CHROME_HEIGHT = 52;

/** Horizontal cost of the player area's `p-1`. */
export const PLAYER_CHROME_WIDTH = 8;

const LANDSCAPE_RATIO = 16 / 9;

/** Portrait previews are height-bound, so they get a share rather than a fit. */
const PORTRAIT_TIMELINE_SHARE = 0.45;

/**
 * The timeline may take at most 70% of the column, and never so much that the
 * preview drops below `MIN_PLAYER_HEIGHT`.
 */
export function maxTimelineHeight(columnHeight: number): number {
  return Math.max(
    MIN_TIMELINE_HEIGHT,
    Math.min(
      Math.round(columnHeight * 0.7),
      columnHeight - SPLITTER_HEIGHT - MIN_PLAYER_HEIGHT
    )
  );
}

/**
 * Clamp a requested timeline height into the column. `columnHeight` of 0 means
 * "not measured yet", where only the floor is knowable.
 */
export function clampTimelineHeight(
  height: number,
  columnHeight: number
): number {
  const floored = Math.max(Math.round(height), MIN_TIMELINE_HEIGHT);
  if (!columnHeight) return floored;
  return Math.min(floored, maxTimelineHeight(columnHeight));
}

/**
 * A phone's opening split, derived rather than guessed.
 *
 * A 16:9 preview in a ~375px-wide column can never be taller than
 * `width / (16/9)` ≈ 206px — every pixel handed to the player area beyond that
 * is pure letterbox. So the timeline takes everything the stage cannot use.
 * Portrait timelines invert the constraint (height is scarce, width is not), so
 * they keep a fixed share instead of a fit.
 */
export function phoneDefaultTimelineHeight({
  columnHeight,
  columnWidth,
  isPortrait,
}: {
  columnHeight: number;
  columnWidth: number;
  isPortrait: boolean;
}): number {
  if (!columnHeight || !columnWidth) return DEFAULT_TIMELINE_HEIGHT;
  if (isPortrait) {
    return clampTimelineHeight(
      Math.round(columnHeight * PORTRAIT_TIMELINE_SHARE),
      columnHeight
    );
  }
  const stageHeight = Math.round(
    (columnWidth - PLAYER_CHROME_WIDTH) / LANDSCAPE_RATIO
  );
  return clampTimelineHeight(
    columnHeight - SPLITTER_HEIGHT - PLAYER_CHROME_HEIGHT - stageHeight,
    columnHeight
  );
}

/**
 * The height to open with: a previously dragged value wins, then the phone's
 * derived fit, then the desktop default. Runs once per mount, as soon as the
 * column has a measured size.
 */
export function resolveInitialTimelineHeight({
  stored,
  columnHeight,
  columnWidth,
  isPortrait,
  isCompact,
}: {
  stored: number | null;
  columnHeight: number;
  columnWidth: number;
  isPortrait: boolean;
  isCompact: boolean;
}): number {
  if (stored !== null && !Number.isNaN(stored)) {
    return clampTimelineHeight(stored, columnHeight);
  }
  if (isCompact) {
    return phoneDefaultTimelineHeight({
      columnHeight,
      columnWidth,
      isPortrait,
    });
  }
  return clampTimelineHeight(DEFAULT_TIMELINE_HEIGHT, columnHeight);
}

/** Bottom-bar preset cycle: balanced → preview-first → timeline-first. */
export type SplitPreset = 'balanced' | 'preview' | 'timeline';

export const SPLIT_PRESET_ORDER: readonly SplitPreset[] = [
  'balanced',
  'preview',
  'timeline',
];

export function nextSplitPreset(current: SplitPreset): SplitPreset {
  const index = SPLIT_PRESET_ORDER.indexOf(current);
  return SPLIT_PRESET_ORDER[(index + 1) % SPLIT_PRESET_ORDER.length];
}

/** Resolve a preset to a concrete, clamped timeline height. */
export function splitPresetHeight(
  preset: SplitPreset,
  {
    columnHeight,
    columnWidth,
    isPortrait,
  }: { columnHeight: number; columnWidth: number; isPortrait: boolean }
): number {
  switch (preset) {
    case 'preview':
      return clampTimelineHeight(MIN_TIMELINE_HEIGHT, columnHeight);
    case 'timeline':
      return clampTimelineHeight(maxTimelineHeight(columnHeight), columnHeight);
    default:
      return phoneDefaultTimelineHeight({
        columnHeight,
        columnWidth,
        isPortrait,
      });
  }
}
