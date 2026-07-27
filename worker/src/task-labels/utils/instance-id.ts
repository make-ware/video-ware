// Stable ids for provider-detected instances within one media.

import { createHash } from 'crypto';

/** The frame shape the tracked-detection responses share. */
export interface InstanceFrame {
  /** Seconds from the start of the media. */
  timeOffset: number;
  boundingBox: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  };
}

/** Round a coordinate to keyframe precision (sub-pixel even at 4K). */
function round4(value: number | undefined): number {
  return Math.round((value ?? 0) * 10000) / 10000;
}

/**
 * A deterministic id for one detected instance, derived from WHAT was
 * detected rather than where it sat in the provider's array.
 *
 * This is the identity that flows into `labelEntityKey`, so it decides
 * whether re-running detection on a media finds its existing LabelEntity
 * rows — and with them every manual "this object is the iPhone" tag — or
 * mints new ones and strands the old. Anything positional is therefore
 * disqualified: GCVI returns the objects in whatever order it found them,
 * the executors filter by confidence before this point, and where the
 * provider omits a track id the executor has no id to pass on at all.
 *
 * What it hashes instead is the detection itself: its name (where the
 * provider gives one), the span it covers on the millisecond grid, and its
 * opening bounding box at keyframe precision. Two detections agreeing on all
 * of that are the same instance; a re-run that agrees on all of that
 * upserts.
 *
 * Not stable across model upgrades — a provider that shifts its boxes or
 * timings mints new instances. That is the honest answer: the detection did
 * change, and `processorVersion` already marks the boundary.
 */
export function deriveInstanceId(parts: {
  /** Short tag naming the detection kind — "obj", "face", "person". */
  kind: string;
  /** The provider's term for the instance, where it has one ("dog"). */
  name?: string;
  frames: InstanceFrame[];
}): string {
  const { kind, name = '', frames } = parts;
  const first = frames[0];
  const last = frames[frames.length - 1];
  const box = first?.boundingBox;
  const material = [
    kind,
    // Case- and whitespace-insensitive, as the pre-per-instance entity hash
    // was: "Food" and "food" are the provider being inconsistent, not two
    // detections.
    name.trim().toLowerCase(),
    Math.round((first?.timeOffset ?? 0) * 1000),
    Math.round((last?.timeOffset ?? 0) * 1000),
    round4(box?.left),
    round4(box?.top),
    round4(box?.right),
    round4(box?.bottom),
  ].join(':');
  const digest = createHash('sha256')
    .update(material)
    .digest('hex')
    .slice(0, 16);
  return `${kind}_${digest}`;
}

/**
 * Keep a run of derived ids unique within one response.
 *
 * A collision means the provider reported the same name over the same span
 * with the same opening box twice — a duplicate detection, not two things.
 * The first occurrence keeps the bare id so its identity never moves; only
 * the duplicates behind it take a suffix.
 */
export function uniqueInstanceId(
  id: string,
  seen: Map<string, number>
): string {
  const occurrence = seen.get(id) ?? 0;
  seen.set(id, occurrence + 1);
  return occurrence === 0 ? id : `${id}_${occurrence}`;
}
