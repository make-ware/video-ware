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

/**
 * `.v2` deliberately abandons every height stored under the old key: those
 * were dragged to compensate for a default that showed less than one lane, so
 * carrying them forward would hide the track-aware default from exactly the
 * people who worked around its absence. The next drag persists as before.
 */
export const TIMELINE_HEIGHT_KEY = 'timeline-editor:timeline-height.v2';

/** Floor for the opening split; desktop derives its own — see below. */
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
 * Lane height, mirroring `TRACK_HEIGHT` in `layer-timeline-view.tsx`. Restated
 * rather than imported so this module stays a leaf with no component
 * dependencies.
 */
export const TRACK_LANE_HEIGHT = 64; // h-16

/** The ruler, sticky at the top of the lane scroller's own viewport. */
const RULER_HEIGHT = 32; // h-8

/**
 * What the timeline pane spends at `lg` before the first lane is drawn:
 *
 * ```
 *  24  pane padding (lg:p-3, top + bottom)
 *  16  "Scrubber & Layers" label row (10px text at the inherited 1.5 leading)
 *   4  gap under it (gap-1)
 *   2  the layer box's border
 *  32  the ruler
 *  16  gap between the layer and selected-clip sections (lg:gap-4)
 *  16  "Selected Clip" label row
 *   6  gap under it (gap-1.5)
 * 160  the selected-clip card (lg:h-40 — same height empty or filled)
 * ```
 *
 * The drop-mode/zoom strip costs nothing here: it only joins the flow below
 * `lg`, where it floats over the lanes instead.
 */
export const TIMELINE_PANE_CHROME_HEIGHT = 276;

/**
 * The lane scroller is always wider than its viewport, so platforms with
 * classic (space-taking) scrollbars lose a strip off the bottom lane. Paying it
 * unconditionally costs macOS a few idle pixels and saves Windows a clipped
 * lane. Only the estimate needs it — a measured chrome has already lost the
 * scrollbar out of `clientHeight`.
 */
const LANE_SCROLLBAR_ALLOWANCE = 16;

/** The estimate used when the live pane can't be measured. */
export const ESTIMATED_PANE_CHROME_HEIGHT =
  TIMELINE_PANE_CHROME_HEIGHT + LANE_SCROLLBAR_ALLOWANCE;

/**
 * How many lanes the opening split tries to reveal. Timelines cap at
 * `MAX_TIMELINE_TRACKS` (4), so three keeps "there's another track down there"
 * off the common path without handing the whole column to the lanes.
 */
export const MAX_FITTED_TRACKS = 3;

/**
 * The preview's opening floor. `MIN_PLAYER_HEIGHT` is the hard limit a drag may
 * reach; this is the softer one an automatic default respects — the split gives
 * up a lane rather than open with a preview this small. Portrait gets more:
 * height is the dimension a 9:16 stage is starved of, so the same pixels buy
 * far less picture.
 */
export const PREVIEW_COMFORT_HEIGHT = 260;
export const PORTRAIT_PREVIEW_COMFORT_HEIGHT = 340;

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
 * The pane's chrome as the browser actually laid it out, from the rendered
 * pane's border box and the lane scroller's viewport. Everything between the
 * two — padding, labels, gaps, borders, the selected-clip card, and a classic
 * scrollbar on platforms that have one — falls out of the subtraction, so the
 * fit never depends on a constant staying in sync with a `className`.
 *
 * The ruler is added back: it lives *inside* the scroller (sticky), so
 * `clientHeight` counts it as lane space when it is not.
 *
 * Returns null when the reading can't be trusted — before layout, or from a
 * pane so short its lane area has already floored at nothing — which leaves the
 * caller on `ESTIMATED_PANE_CHROME_HEIGHT`.
 */
export function measureTimelinePaneChrome({
  paneHeight,
  laneViewportHeight,
}: {
  paneHeight: number;
  laneViewportHeight: number;
}): number | null {
  if (paneHeight <= 0 || laneViewportHeight <= RULER_HEIGHT) return null;
  // The scroller is nested inside the pane, so it can only read as tall as one
  // mid-transition — a reading that would understate the chrome.
  if (laneViewportHeight >= paneHeight) return null;
  // Both guards together leave this strictly between 0 and `paneHeight`.
  return Math.round(paneHeight - laneViewportHeight + RULER_HEIGHT);
}

/** Pane height at which `trackCount` lanes are fully visible. */
export function timelineHeightForTracks(
  trackCount: number,
  chromeHeight: number = ESTIMATED_PANE_CHROME_HEIGHT
): number {
  return chromeHeight + Math.max(1, Math.round(trackCount)) * TRACK_LANE_HEIGHT;
}

/**
 * Desktop's opening split, sized to the timeline it is opening.
 *
 * A flat 320 predates the selected-clip card: ~276 of it is chrome, so an
 * editor opened at the default showed *less than one* lane and every session
 * began with a drag. Instead the pane asks for as many lanes as it can show
 * without pushing the preview under its comfort floor, drops a lane at a time
 * on short screens, and never opens smaller than the old default.
 *
 * `SPLITTER_HEIGHT` (24) overstates the desktop handle (10) — the same
 * conservative figure `clampTimelineHeight` uses, and being 14px shy of the
 * budget only ever spends less.
 */
export function desktopDefaultTimelineHeight({
  trackCount,
  columnHeight,
  isPortrait,
  chromeHeight,
}: {
  trackCount: number;
  columnHeight: number;
  isPortrait: boolean;
  /** Measured chrome; falls back to the estimate when unmeasurable. */
  chromeHeight?: number | null;
}): number {
  if (!columnHeight) return DEFAULT_TIMELINE_HEIGHT;

  const chrome = chromeHeight ?? ESTIMATED_PANE_CHROME_HEIGHT;
  const comfort = isPortrait
    ? PORTRAIT_PREVIEW_COMFORT_HEIGHT
    : PREVIEW_COMFORT_HEIGHT;
  const budget = columnHeight - SPLITTER_HEIGHT - comfort;
  const wanted = Math.min(Math.max(trackCount, 1), MAX_FITTED_TRACKS);

  for (let lanes = wanted; lanes >= 1; lanes--) {
    const height = timelineHeightForTracks(lanes, chrome);
    if (height <= budget) {
      return clampTimelineHeight(
        Math.max(height, DEFAULT_TIMELINE_HEIGHT),
        columnHeight
      );
    }
  }
  return clampTimelineHeight(DEFAULT_TIMELINE_HEIGHT, columnHeight);
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
 * derived fit, then desktop's track-aware fit. Runs once per mount, as soon as
 * the column has a measured size.
 *
 * Phones keep their own derivation: their pane sheds most of the chrome the
 * desktop fit is built around (no section labels, `p-1`, and a selected-clip
 * card that only appears once something is selected), and the 16:9 letterbox
 * already hands them more lanes than a fit would ask for.
 */
export function resolveInitialTimelineHeight({
  stored,
  columnHeight,
  columnWidth,
  isPortrait,
  isCompact,
  trackCount,
  chromeHeight,
}: {
  stored: number | null;
  columnHeight: number;
  columnWidth: number;
  isPortrait: boolean;
  isCompact: boolean;
  trackCount: number;
  chromeHeight?: number | null;
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
  return desktopDefaultTimelineHeight({
    trackCount,
    columnHeight,
    isPortrait,
    chromeHeight,
  });
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
