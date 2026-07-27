import { describe, it, expect } from 'vitest';
import {
  clampTimelineHeight,
  DEFAULT_TIMELINE_HEIGHT,
  maxTimelineHeight,
  MIN_TIMELINE_HEIGHT,
  nextSplitPreset,
  phoneDefaultTimelineHeight,
  resolveInitialTimelineHeight,
  splitPresetHeight,
} from '../timeline-split';

// Reference viewports. The shell is the viewport minus the 41px nav; the
// player+timeline column is the shell minus the toolbar and (on a phone) the
// bottom bar.
const PHONE_COLUMN = { columnHeight: 534, columnWidth: 375 }; // 375x667, no browser chrome
const SHORT_PHONE_COLUMN = { columnHeight: 440, columnWidth: 375 }; // iOS Safari, bars shown
const TALL_PHONE_COLUMN = { columnHeight: 711, columnWidth: 375 }; // 375x844
const DESKTOP_COLUMN = { columnHeight: 803, columnWidth: 1440 }; // 1440x900

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

describe('resolveInitialTimelineHeight', () => {
  it('prefers a stored drag over any derived value', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: 260,
        ...PHONE_COLUMN,
        isPortrait: false,
        isCompact: true,
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
      })
    ).toBe(252);
  });

  it('keeps the 320px desktop default above lg', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: null,
        ...DESKTOP_COLUMN,
        isPortrait: false,
        isCompact: false,
      })
    ).toBe(DEFAULT_TIMELINE_HEIGHT);
  });

  it('treats a NaN stored value as absent', () => {
    expect(
      resolveInitialTimelineHeight({
        stored: NaN,
        ...DESKTOP_COLUMN,
        isPortrait: false,
        isCompact: false,
      })
    ).toBe(DEFAULT_TIMELINE_HEIGHT);
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
