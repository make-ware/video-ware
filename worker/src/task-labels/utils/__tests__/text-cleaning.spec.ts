import { describe, it, expect } from 'vitest';
import {
  cleanDetectedTexts,
  normalizeText,
  resolveTextCleaningOptions,
  DEFAULT_TEXT_CLEANING,
} from '../text-cleaning';
import type { DetectedTextSegment, TextFrame } from '../../types';

function frame(
  timeOffset: number,
  box: { left: number; top: number; right: number; bottom: number } = {
    left: 0.1,
    top: 0.1,
    right: 0.5,
    bottom: 0.2,
  }
): TextFrame {
  return { timeOffset, boundingBox: box };
}

function segment(
  text: string,
  confidence: number,
  startTime: number,
  endTime: number,
  frames: TextFrame[] = [frame(startTime), frame(endTime)]
): DetectedTextSegment {
  return { text, confidence, startTime, endTime, frames };
}

/**
 * Real-world noise: a sign ("SISAK 40") and a door label ("Staff only")
 * OCR'd as a burst of sub-second fragments and misread variants.
 */
const NOISY_SAMPLE: DetectedTextSegment[] = [
  segment('SISAK40', 0.89, 168.54, 168.54),
  segment('Statf only', 0.81, 168.66, 168.66),
  segment('6ISAK 40', 0.83, 168.66, 168.66),
  segment('Staff anly', 0.91, 168.79, 168.79),
  segment('SISAK 40', 0.84, 168.79, 169.66),
  segment('Staff enly', 0.87, 169.04, 169.41),
  segment('Nema', 0.91, 169.29, 169.54),
  segment('Staff only', 0.87, 169.54, 170.54),
  segment('SISAK 40', 0.85, 169.79, 169.79),
];

describe('normalizeText', () => {
  it('case-folds and collapses whitespace', () => {
    expect(normalizeText('  Staff   Only ')).toBe('staff only');
    expect(normalizeText('SISAK\t40')).toBe('sisak 40');
  });
});

describe('resolveTextCleaningOptions', () => {
  it('returns defaults when nothing is given', () => {
    expect(resolveTextCleaningOptions()).toEqual(DEFAULT_TEXT_CLEANING);
  });

  it('ignores undefined overrides but applies defined ones', () => {
    const resolved = resolveTextCleaningOptions({
      minConfidence: undefined,
      minDurationSec: 0.5,
    });
    expect(resolved.minConfidence).toBe(DEFAULT_TEXT_CLEANING.minConfidence);
    expect(resolved.minDurationSec).toBe(0.5);
  });
});

describe('cleanDetectedTexts', () => {
  it('reduces the noisy fragment burst to the two real strings', () => {
    const runs = cleanDetectedTexts(NOISY_SAMPLE);

    expect(runs.map((r) => r.text)).toEqual(['SISAK 40', 'Staff only']);

    // "SISAK 40" fragments (gap 0.13s) merged into one ≥1s run
    const sisak = runs[0];
    expect(sisak.start).toBeCloseTo(168.79);
    expect(sisak.end).toBeCloseTo(169.79);
    expect(sisak.segmentCount).toBe(2);
    expect(sisak.confidence).toBe(0.85); // best across merged segments

    // "Staff only" survives on its own exact-1s appearance
    const staff = runs[1];
    expect(staff.start).toBeCloseTo(169.54);
    expect(staff.end).toBeCloseTo(170.54);
    expect(staff.segmentCount).toBe(1);
  });

  it('keeps a run whose duration is exactly the minimum', () => {
    const runs = cleanDetectedTexts([segment('EXACT', 0.9, 10.0, 11.0)]);
    expect(runs).toHaveLength(1);
  });

  it('drops sub-threshold flickers and low-confidence runs', () => {
    const runs = cleanDetectedTexts([
      segment('flicker', 0.99, 5.0, 5.4),
      segment('low confidence', 0.6, 10.0, 20.0),
    ]);
    expect(runs).toHaveLength(0);
  });

  it('does not merge appearances separated by more than the gap', () => {
    const runs = cleanDetectedTexts([
      segment('BREAKING NEWS', 0.97, 1.0, 5.0),
      segment('BREAKING NEWS', 0.93, 30.0, 33.5),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].start).toBe(1.0);
    expect(runs[1].start).toBe(30.0);
  });

  it('merges frames sorted by time and picks the best-confidence variant text', () => {
    const runs = cleanDetectedTexts([
      segment('staff only', 0.86, 10.0, 11.0, [frame(10.0), frame(11.0)]),
      segment('Staff Only', 0.95, 11.5, 12.5, [frame(11.5), frame(12.5)]),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Staff Only');
    expect(runs[0].confidence).toBe(0.95);
    expect(runs[0].frames.map((f) => f.timeOffset)).toEqual([
      10.0, 11.0, 11.5, 12.5,
    ]);
  });

  it('drops text contained in a longer overlapping run at the same position', () => {
    const box = { left: 0.3, top: 0.5, right: 0.7, bottom: 0.55 };
    const runs = cleanDetectedTexts([
      segment('www.isak.is', 0.98, 10.0, 15.0, [
        frame(10, box),
        frame(15, box),
      ]),
      segment('ISAK', 0.95, 11.0, 14.0, [frame(11, box), frame(14, box)]),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['www.isak.is']);
  });

  it('keeps contained text when it sits elsewhere on screen', () => {
    const urlBox = { left: 0.3, top: 0.9, right: 0.7, bottom: 0.95 };
    const logoBox = { left: 0.05, top: 0.05, right: 0.2, bottom: 0.15 };
    const runs = cleanDetectedTexts([
      segment('www.isak.is', 0.98, 10.0, 15.0, [
        frame(10, urlBox),
        frame(15, urlBox),
      ]),
      segment('ISAK', 0.95, 11.0, 14.0, [
        frame(11, logoBox),
        frame(14, logoBox),
      ]),
    ]);
    expect(runs.map((r) => r.text).sort()).toEqual(['ISAK', 'www.isak.is']);
  });

  it('keeps contained text when it does not overlap in time', () => {
    const runs = cleanDetectedTexts([
      segment('www.isak.is', 0.98, 10.0, 15.0),
      segment('ISAK', 0.95, 40.0, 45.0),
    ]);
    expect(runs).toHaveLength(2);
  });

  it('keeps contained text when dedupeContainedText is off', () => {
    const box = { left: 0.3, top: 0.5, right: 0.7, bottom: 0.55 };
    const runs = cleanDetectedTexts(
      [
        segment('www.isak.is', 0.98, 10.0, 15.0, [frame(10, box)]),
        segment('ISAK', 0.95, 11.0, 14.0, [frame(11, box)]),
      ],
      { dedupeContainedText: false }
    );
    expect(runs).toHaveLength(2);
  });

  it('treats frameless runs as spatially overlapping for dedup', () => {
    const runs = cleanDetectedTexts([
      segment('www.isak.is', 0.98, 10.0, 15.0, []),
      segment('ISAK', 0.95, 11.0, 14.0, []),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['www.isak.is']);
  });

  it('ignores empty and whitespace-only text', () => {
    const runs = cleanDetectedTexts([
      segment('   ', 0.99, 10.0, 20.0),
      segment('', 0.99, 10.0, 20.0),
    ]);
    expect(runs).toHaveLength(0);
  });

  it('honors threshold overrides', () => {
    const runs = cleanDetectedTexts(NOISY_SAMPLE, {
      minDurationSec: 0,
      minConfidence: 0,
      mergeGapSec: 0,
    });
    // No merging (all SISAK 40 gaps > 0) and no filtering: every distinct
    // normalized string appears, fragments and misreads included.
    expect(runs.length).toBeGreaterThan(2);
    expect(runs.map((r) => normalizeText(r.text))).toContain('nema');
  });

  it('returns runs sorted by start time', () => {
    const runs = cleanDetectedTexts([
      segment('later', 0.95, 50.0, 55.0),
      segment('earlier', 0.95, 1.0, 5.0),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['earlier', 'later']);
  });
});
