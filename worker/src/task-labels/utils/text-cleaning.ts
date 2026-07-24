/**
 * Text detection cleaning
 *
 * GCVI TEXT_DETECTION output is extremely noisy: the same on-screen string
 * comes back as many near-zero-duration segments, interleaved with
 * low-confidence OCR misreads ("Statf only" for "Staff only"). This module
 * turns that raw stream into clean rows in four steps:
 *
 * 1. Merge — group segments by normalized text and merge runs that overlap
 *    or sit within `mergeGapSec` of each other into one appearance.
 * 2. Duration filter — drop merged runs shorter than `minDurationSec`;
 *    real on-screen text persists, transitional misreads flicker.
 * 3. Confidence filter — drop runs whose best confidence is below
 *    `minConfidence`.
 * 4. Containment dedup — drop a run whose text is a fragment of a longer
 *    run on screen at the same time and place ("ISAK" inside "www.isak.is").
 *
 * Pure functions, applied by the normalizer AFTER the cache layer: the cache
 * keeps the raw provider response, so thresholds can be tuned and re-applied
 * to cached data without new API calls.
 */

import type { DetectedTextSegment, TextFrame } from '../types';

export interface TextCleaningOptions {
  /** Drop merged runs shorter than this many seconds. */
  minDurationSec: number;
  /** Drop merged runs whose best confidence is below this (0–1). */
  minConfidence: number;
  /**
   * Merge same-text segments separated by at most this many seconds — OCR
   * drops out for a few frames even while the text stays on screen.
   */
  mergeGapSec: number;
  /**
   * Drop a run whose text is contained in a longer run that overlaps it in
   * both time and screen position.
   */
  dedupeContainedText: boolean;
}

export const DEFAULT_TEXT_CLEANING: TextCleaningOptions = {
  minDurationSec: 1.0,
  minConfidence: 0.85,
  mergeGapSec: 1.0,
  dedupeContainedText: true,
};

/** Tolerance for float comparisons on the seconds grid. */
const EPSILON = 1e-3;

/**
 * One cleaned appearance of a text string: possibly many raw API segments
 * merged into a single run.
 */
export interface CleanedTextRun {
  /** Display text — the highest-confidence variant among merged segments. */
  text: string;
  /** Case-folded, whitespace-collapsed key the run was grouped under. */
  normalizedText: string;
  /** Best confidence across merged segments. */
  confidence: number;
  start: number;
  end: number;
  /** All frames from merged segments, sorted by time. */
  frames: TextFrame[];
  /** How many raw API segments merged into this run. */
  segmentCount: number;
}

/** Grouping key: whitespace-collapsed, case-folded. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Resolve partial options against the defaults, ignoring undefined values.
 */
export function resolveTextCleaningOptions(
  options?: Partial<TextCleaningOptions>
): TextCleaningOptions {
  const resolved = { ...DEFAULT_TEXT_CLEANING };
  if (!options) return resolved;
  for (const key of Object.keys(options) as (keyof TextCleaningOptions)[]) {
    const value = options[key];
    if (value !== undefined) {
      (resolved as Record<string, unknown>)[key] = value;
    }
  }
  return resolved;
}

/**
 * Clean raw text detection segments into merged, filtered runs, sorted by
 * start time.
 */
export function cleanDetectedTexts(
  texts: DetectedTextSegment[],
  options?: Partial<TextCleaningOptions>
): CleanedTextRun[] {
  const opts = resolveTextCleaningOptions(options);

  const merged = mergeSegments(texts, opts.mergeGapSec);

  const filtered = merged.filter(
    (run) =>
      run.end - run.start + EPSILON >= opts.minDurationSec &&
      run.confidence + EPSILON >= opts.minConfidence
  );

  const deduped = opts.dedupeContainedText
    ? dropContainedRuns(filtered)
    : filtered;

  return deduped.sort(
    (a, b) =>
      a.start - b.start || a.normalizedText.localeCompare(b.normalizedText)
  );
}

/**
 * Group segments by normalized text and merge each group's overlapping or
 * near-adjacent segments into runs.
 */
function mergeSegments(
  texts: DetectedTextSegment[],
  mergeGapSec: number
): CleanedTextRun[] {
  const groups = new Map<string, DetectedTextSegment[]>();
  for (const segment of texts) {
    const key = normalizeText(segment.text);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.push(segment);
    } else {
      groups.set(key, [segment]);
    }
  }

  const runs: CleanedTextRun[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.startTime - b.startTime);

    let current: CleanedTextRun | null = null;
    for (const segment of group) {
      if (current && segment.startTime <= current.end + mergeGapSec + EPSILON) {
        current.end = Math.max(current.end, segment.endTime);
        current.frames.push(...segment.frames);
        current.segmentCount += 1;
        if (segment.confidence > current.confidence) {
          current.confidence = segment.confidence;
          current.text = segment.text;
        }
      } else {
        if (current) runs.push(current);
        current = {
          text: segment.text,
          normalizedText: key,
          confidence: segment.confidence,
          start: segment.startTime,
          end: segment.endTime,
          frames: [...segment.frames],
          segmentCount: 1,
        };
      }
    }
    if (current) runs.push(current);
  }

  for (const run of runs) {
    run.frames.sort((a, b) => a.timeOffset - b.timeOffset);
  }

  return runs;
}

/**
 * Drop runs whose text is strictly contained in a longer run that overlaps
 * them in time and (when both have boxes) in screen position.
 */
function dropContainedRuns(runs: CleanedTextRun[]): CleanedTextRun[] {
  const bboxes = runs.map((run) => unionBbox(run.frames));

  return runs.filter(
    (run, i) =>
      !runs.some((other, j) => {
        if (i === j) return false;
        if (other.normalizedText === run.normalizedText) return false;
        if (!other.normalizedText.includes(run.normalizedText)) return false;
        const timeOverlap =
          run.start <= other.end + EPSILON && other.start <= run.end + EPSILON;
        if (!timeOverlap) return false;
        return bboxesOverlap(bboxes[i], bboxes[j]);
      })
  );
}

interface Bbox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Union of a run's frame boxes; null when the run carries no frames. */
function unionBbox(frames: TextFrame[]): Bbox | null {
  if (frames.length === 0) return null;
  const bbox = { ...frames[0].boundingBox };
  for (const frame of frames) {
    bbox.left = Math.min(bbox.left, frame.boundingBox.left);
    bbox.top = Math.min(bbox.top, frame.boundingBox.top);
    bbox.right = Math.max(bbox.right, frame.boundingBox.right);
    bbox.bottom = Math.max(bbox.bottom, frame.boundingBox.bottom);
  }
  return bbox;
}

/**
 * Whether two run boxes intersect. A missing box (frameless run) counts as
 * overlapping — time overlap plus text containment is already strong
 * evidence, and a fragment shouldn't survive just because its frames are
 * absent.
 */
function bboxesOverlap(a: Bbox | null, b: Bbox | null): boolean {
  if (!a || !b) return true;
  return (
    a.left <= b.right + EPSILON &&
    b.left <= a.right + EPSILON &&
    a.top <= b.bottom + EPSILON &&
    b.top <= a.bottom + EPSILON
  );
}
