import { describe, it, expect } from 'vitest';
import {
  clampTimelineHeight,
  DEFAULT_TIMELINE_HEIGHT,
  desktopDefaultTimelineHeight,
  ESTIMATED_PANE_CHROME_HEIGHT,
  MAX_FITTED_TRACKS,
  measureTimelinePaneChrome,
  maxTimelineHeight,
  MIN_TIMELINE_HEIGHT,
  nextSplitPreset,
  phoneDefaultTimelineHeight,
  PREVIEW_COMFORT_HEIGHT,
  resolveInitialTimelineHeight,
  splitPresetHeight,
  timelineHeightForTracks,
  TIMELINE_PANE_CHROME_HEIGHT,
  TRACK_LANE_HEIGHT,
} from '../timeline-split';

// Reference viewports. The shell is the viewport minus the 41px nav; the
// player+timeline column is the shell minus the toolbar and (on a phone) the
// bottom bar.
const PHONE_COLUMN = { columnHeight: 534, columnWidth: 375 }; // 375x667, no browser chrome
const SHORT_PHONE_COLUMN = { columnHeight: 440, columnWidth: 375 }; // iOS Safari, bars shown
const TALL_PHONE_COLUMN = { columnHeight: 711, columnWidth: 375 }; // 375x844
const DESKTOP_COLUMN = { columnHeight: 803, columnWidth: 1440 }; // 1440x900
const LAPTOP_COLUMN = { columnHeight: 671, columnWidth: 1366 }; // 1366x768

describe('clampTimelineHeight', () => {
  it('floors at MIN_TIMELINE_HEIGHT', () => {
    expect(clampTimelineHeight(10, PHONE_COLUMN.columnHeight)).toBe(
      MIN_TIMELINE_HEIGHT
    );
  });

  it('never starves the preview below MIN_PLAYER_HEIGHT', () => {
    // 534 - 24 splitter - 160 preview = 350, which is the binding cap here
    // (70% of 534 would be 374).
    expect(clampTimelineHeight(9999, PHONE_COLUMN.columnHeight)).toBe(350);
  });

  it('caps at 70% of the column when that is the tighter limit', () => {
    expect(clampTimelineHeight(9999, DESKTOP_COLUMN.columnHeight)).toBe(562);
    expect(maxTimelineHeight(DESKTOP_COLUMN.columnHeight)).toBe(562);
  });

  it('passes a value already inside the window through unchanged', () => {
    expect(clampTimelineHeight(320, DESKTOP_COLUMN.columnHeight)).toBe(320);
  });

  it('applies only the floor before the column is measured', () => {
    expect(clampTimelineHeight(9999, 0)).toBe(9999);
    expect(clampTimelineHeight(10, 0)).toBe(MIN_TIMELINE_HEIGHT);
  });

  it('collapses to the floor on a column too short to satisfy both', () => {
    // 200 - 24 - 160 = 16, well under the floor.
    expect(clampTimelineHeight(320, 200)).toBe(MIN_TIMELINE_HEIGHT);
  });
});

describe('phoneDefaultTimelineHeight', () => {
  it('gives the lanes everything a 16:9 preview cannot use', () => {
    // stage = (375 - 8) / (16/9) = 206 → 534 - 24 - 52 - 206 = 252
    expect(
      phoneDefaultTimelineHeight({ ...PHONE_COLUMN, isPortrait: false })
    ).toBe(252);
  });

  it('scales with a taller viewport', () => {
    expect(
      phoneDefaultTimelineHeight({ ...TALL_PHONE_COLUMN, isPortrait: false })
    ).toBe(429);
  });

  it('falls back to the floor when browser chrome squeezes the column', () => {
    // 440 - 24 - 52 - 206 = 158, under the floor.
    expect(
      phoneDefaultTimelineHeight({ ...SHORT_PHONE_COLUMN, isPortrait: false })
    ).toBe(MIN_TIMELINE_HEIGHT);
  });

  it('gives a portrait preview the larger share — height is what it lacks', () => {
    const portrait = phoneDefaultTimelineHeight({
      ...PHONE_COLUMN,
      isPortrait: true,
    });
    const landscape = phoneDefaultTimelineHeight({
      ...PHONE_COLUMN,
      isPortrait: false,
    });
    expect(portrait).toBe(240);
    expect(portrait).toBeLessThan(landscape);
  });

  it('never exceeds the clamp', () => {
    for (const height of [200, 320, 440, 534, 711, 900]) {
      const derived = phoneDefaultTimelineHeight({
        columnHeight: height,
        columnWidth: 375,
        isPortrait: false,
      });
      expect(derived).toBeLessThanOrEqual(maxTimelineHeight(height));
      expect(derived).toBeGreaterThanOrEqual(MIN_TIMELINE_HEIGHT);
    }
  });

  it('returns the desktop default when nothing is measured', () => {
    expect(
      phoneDefaultTimelineHeight({
        columnHeight: 0,
        columnWidth: 0,
        isPortrait: false,
      })
    ).toBe(DEFAULT_TIMELINE_HEIGHT);
  });
});

describe('measureTimelinePaneChrome', () => {
  it('recovers the chrome the pane spends outside its lanes', () => {
    // A 320px pane whose scroller viewport is 76px: 32 of that is the ruler,
    // so 44px reaches the lanes and 276 went to chrome.
    expect(
      measureTimelinePaneChrome({ paneHeight: 320, laneViewportHeight: 76 })
    ).toBe(276);
  });

  it('round-trips: a fitted height shows exactly the lanes asked for', () => {
    const chrome = measureTimelinePaneChrome({
      paneHeight: 320,
      laneViewportHeight: 76,
    });
    const fitted = timelineHeightForTracks(3, chrome ?? undefined);
    // Re-measuring that pane leaves 3 lanes' worth below the ruler.
    const laneSpace = fitted - (chrome ?? 0);
    expect(laneSpace).toBe(3 * TRACK_LANE_HEIGHT);
  });

  it('rejects a pane whose lane area has already collapsed', () => {
    expect(
      measureTimelinePaneChrome({ paneHeight: 200, laneViewportHeight: 32 })
    ).toBeNull();
    expect(
      measureTimelinePaneChrome({ paneHeight: 200, laneViewportHeight: 0 })
    ).toBeNull();
  });

  it('rejects an unlaid-out pane', () => {
    expect(
      measureTimelinePaneChrome({ paneHeight: 0, laneViewportHeight: 0 })
    ).toBeNull();
  });

  it('rejects a reading that would leave no room for a lane', () => {
    // Scroller taller than the pane (mid-transition layout): chrome would come
    // out at or above the pane height, which describes nothing usable.
    expect(
      measureTimelinePaneChrome({ paneHeight: 100, laneViewportHeight: 100 })
    ).toBeNull();
  });
});

describe('timelineHeightForTracks', () => {
  it('defaults to the estimate when nothing was measured', () => {
    expect(timelineHeightForTracks(1)).toBe(
      ESTIMATED_PANE_CHROME_HEIGHT + TRACK_LANE_HEIGHT
    );
  });

  it('uses a measured chrome over the estimate', () => {
    expect(timelineHeightForTracks(2, 300)).toBe(300 + 2 * TRACK_LANE_HEIGHT);
  });

  it('costs exactly one lane per track above the pane chrome', () => {
    for (const lanes of [1, 2, 3, 4]) {
      expect(timelineHeightForTracks(lanes) - timelineHeightForTracks(1)).toBe(
        (lanes - 1) * TRACK_LANE_HEIGHT
      );
    }
  });

  it('leaves room for a lane below the chrome even at zero tracks', () => {
    expect(timelineHeightForTracks(0)).toBe(timelineHeightForTracks(1));
    expect(timelineHeightForTracks(1)).toBeGreaterThan(
      TIMELINE_PANE_CHROME_HEIGHT + TRACK_LANE_HEIGHT
    );
  });

  it('is what the old flat default was NOT: 320 shows less than one lane', () => {
    expect(DEFAULT_TIMELINE_HEIGHT).toBeLessThan(timelineHeightForTracks(1));
  });
});

describe('desktopDefaultTimelineHeight', () => {
  const desktop = (trackCount: number, isPortrait = false) =>
    desktopDefaultTimelineHeight({
      trackCount,
      columnHeight: DESKTOP_COLUMN.columnHeight,
      isPortrait,
    });

  it('opens with every track visible up to the fit cap', () => {
    expect(desktop(1)).toBe(timelineHeightForTracks(1));
    expect(desktop(2)).toBe(timelineHeightForTracks(2));
    expect(desktop(3)).toBe(timelineHeightForTracks(3));
  });

  it('stops growing past the cap — the 4th track scrolls', () => {
    expect(desktop(4)).toBe(timelineHeightForTracks(MAX_FITTED_TRACKS));
    expect(desktop(9)).toBe(timelineHeightForTracks(MAX_FITTED_TRACKS));
  });

  it('treats a trackless timeline as one lane', () => {
    expect(desktop(0)).toBe(timelineHeightForTracks(1));
  });

  it('never opens below the old flat default', () => {
    for (const columnHeight of [400, 500, 671, 803, 983]) {
      expect(
        desktopDefaultTimelineHeight({
          trackCount: 1,
          columnHeight,
          isPortrait: false,
        })
      ).toBeGreaterThanOrEqual(
        Math.min(DEFAULT_TIMELINE_HEIGHT, maxTimelineHeight(columnHeight))
      );
    }
  });

  it('drops lanes rather than squeeze the preview on a short column', () => {
    // 671 - 24 splitter - 260 comfort = 387: two lanes (420) no longer fit.
    expect(
      desktopDefaultTimelineHeight({
        trackCount: 3,
        columnHeight: LAPTOP_COLUMN.columnHeight,
        isPortrait: false,
      })
    ).toBe(timelineHeightForTracks(1));
  });

  it('keeps the preview above its comfort floor whenever it fits a lane', () => {
    for (const columnHeight of [560, 620, 671, 803, 983, 1200]) {
      for (const trackCount of [1, 2, 3, 4]) {
        const height = desktopDefaultTimelineHeight({
          trackCount,
          columnHeight,
          isPortrait: false,
        });
        if (height <= DEFAULT_TIMELINE_HEIGHT) continue; // fell back
        expect(columnHeight - height).toBeGreaterThanOrEqual(
          PREVIEW_COMFORT_HEIGHT
        );
      }
    }
  });

  it('falls back to the flat default when not even one lane fits', () => {
    // 500 - 24 - 260 = 216, under a single lane's 356.
    expect(
      desktopDefaultTimelineHeight({
        trackCount: 3,
        columnHeight: 500,
        isPortrait: false,
      })
    ).toBe(clampTimelineHeight(DEFAULT_TIMELINE_HEIGHT, 500));
  });

  it('buys a portrait preview more height, at a lane', () => {
    expect(desktop(3, true)).toBe(timelineHeightForTracks(2));
    expect(desktop(3, true)).toBeLessThan(desktop(3, false));
  });

  it('stays inside the drag clamp at every size', () => {
    for (const columnHeight of [300, 500, 671, 803, 983, 1400]) {
      for (const trackCount of [0, 1, 2, 3, 4]) {
        const height = desktopDefaultTimelineHeight({
          trackCount,
          columnHeight,
          isPortrait: false,
        });
        expect(height).toBe(clampTimelineHeight(height, columnHeight));
      }
    }
  });

  it('returns the flat default before the column is measured', () => {
    expect(
      desktopDefaultTimelineHeight({
        trackCount: 3,
        columnHeight: 0,
        isPortrait: false,
      })
    ).toBe(DEFAULT_TIMELINE_HEIGHT);
  });

  it('spends a measured chrome instead of the estimate', () => {
    expect(
      desktopDefaultTimelineHeight({
        trackCount: 2,
        columnHeight: DESKTOP_COLUMN.columnHeight,
        isPortrait: false,
        chromeHeight: 300,
      })
    ).toBe(300 + 2 * TRACK_LANE_HEIGHT);
  });

  it('falls back to the estimate when the measurement failed', () => {
    expect(
      desktopDefaultTimelineHeight({
        trackCount: 2,
        columnHeight: DESKTOP_COLUMN.columnHeight,
        isPortrait: false,
        chromeHeight: null,
      })
    ).toBe(timelineHeightForTracks(2));
  });

  it('drops a lane when the measured chrome is heavier than estimated', () => {
    // 803 - 24 - 260 = 519 of budget; at 360 of chrome, three lanes (552) no
    // longer fit but two (488) do.
    expect(
      desktopDefaultTimelineHeight({
        trackCount: 3,
        columnHeight: DESKTOP_COLUMN.columnHeight,
        isPortrait: false,
        chromeHeight: 360,
      })
    ).toBe(360 + 2 * TRACK_LANE_HEIGHT);
  });
});

describe('resolveInitialTimelineHeight', () => {
  it('prefers a stored drag over any derived value', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: 260,
        ...PHONE_COLUMN,
        isPortrait: false,
        isCompact: true,
        trackCount: 3,
      })
    ).toBe(260);
  });

  it('clamps a stored value that no longer fits the column', () => {
    // A 500px timeline dragged on desktop, reopened on a phone.
    expect(
      resolveInitialTimelineHeight({
        stored: 500,
        ...PHONE_COLUMN,
        isPortrait: false,
        isCompact: true,
        trackCount: 3,
      })
    ).toBe(350);
  });

  it('derives the phone default when there is nothing stored', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: null,
        ...PHONE_COLUMN,
        isPortrait: false,
        isCompact: true,
        trackCount: 3,
      })
    ).toBe(252);
  });

  it('ignores the track count on a phone — the letterbox fit wins', () => {
    const oneTrack = resolveInitialTimelineHeight({
      stored: null,
      ...PHONE_COLUMN,
      isPortrait: false,
      isCompact: true,
      trackCount: 1,
    });
    expect(oneTrack).toBe(252);
  });

  it('fits the tracks above lg instead of the old flat 320', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: null,
        ...DESKTOP_COLUMN,
        isPortrait: false,
        isCompact: false,
        trackCount: 2,
      })
    ).toBe(timelineHeightForTracks(2));
  });

  it('treats a NaN stored value as absent', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: NaN,
        ...DESKTOP_COLUMN,
        isPortrait: false,
        isCompact: false,
        trackCount: 1,
      })
    ).toBe(timelineHeightForTracks(1));
  });
});

describe('split presets', () => {
  it('cycles balanced → preview → timeline → balanced', () => {
    expect(nextSplitPreset('balanced')).toBe('preview');
    expect(nextSplitPreset('preview')).toBe('timeline');
    expect(nextSplitPreset('timeline')).toBe('balanced');
  });

  it('maps each preset to a clamped height', () => {
    const geometry = { ...PHONE_COLUMN, isPortrait: false };
    expect(splitPresetHeight('preview', geometry)).toBe(MIN_TIMELINE_HEIGHT);
    expect(splitPresetHeight('timeline', geometry)).toBe(350);
    expect(splitPresetHeight('balanced', geometry)).toBe(252);
  });
});
