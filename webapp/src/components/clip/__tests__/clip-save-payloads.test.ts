import { describe, it, expect } from 'vitest';
import { ClipType } from '@project/shared';
import {
  buildMediaClipSegmentsPatch,
  buildTimelineClipUpdates,
} from '../clip-save-payloads';
import type { ExpandedTimelineClip } from '@/types/expanded-types';

const segments = [
  { start: 20, end: 30 },
  { start: 0, end: 10 },
];

describe('buildMediaClipSegmentsPatch', () => {
  it('converts a plain clip: sets type, derived times, merged clipData', () => {
    const patch = buildMediaClipSegmentsPatch({
      clip: {
        type: ClipType.USER,
        clipData: { gapThreshold: 2 },
      },
      segments,
      mediaDuration: 60,
    });

    expect(patch).toEqual({
      type: ClipType.COMPOSITE,
      start: 0,
      end: 30,
      duration: 20, // effective (gap-skipping), not end - start
      clipData: {
        gapThreshold: 2,
        segments: [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
        ],
      },
    });
  });

  it('does not re-set type on an already-composite clip', () => {
    const patch = buildMediaClipSegmentsPatch({
      clip: { type: ClipType.COMPOSITE, clipData: {} },
      segments,
      mediaDuration: 60,
    });
    expect(patch).not.toHaveProperty('type');
  });

  it('clamps segments to the media duration', () => {
    const patch = buildMediaClipSegmentsPatch({
      clip: { type: ClipType.COMPOSITE, clipData: {} },
      segments: [{ start: 20, end: 99 }],
      mediaDuration: 25,
    });
    expect((patch.clipData as { segments: unknown }).segments).toEqual([
      { start: 20, end: 25 },
    ]);
  });
});

describe('buildTimelineClipUpdates', () => {
  const clip = {
    meta: { gain: 0.5, mediaMissing: false },
  } as unknown as Pick<ExpandedTimelineClip, 'meta'>;

  it('writes copy-on-write meta.segments with effective duration', () => {
    const updates = buildTimelineClipUpdates({
      clip,
      startTime: 0,
      endTime: 30,
      segments,
      mediaDuration: 60,
      title: 'Interview',
      color: 'bg-blue-600',
      gain: 0.8,
    });

    expect(updates).toEqual({
      start: 0,
      end: 30,
      duration: 20,
      meta: {
        mediaMissing: false,
        title: 'Interview',
        color: 'bg-blue-600',
        gain: 0.8,
        segments: [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
        ],
      },
    });
  });

  it('keeps the full edit list when the window trims it (non-destructive)', () => {
    const updates = buildTimelineClipUpdates({
      clip,
      // window keeps [5,10] + [20,25] → 10s effective
      startTime: 5,
      endTime: 25,
      segments,
      mediaDuration: 60,
      title: '',
      color: 'bg-blue-600',
      gain: 1,
    });

    expect(updates.start).toBe(5);
    expect(updates.end).toBe(25);
    expect(updates.duration).toBe(10);
    // the FULL list persists — the trim is reversible
    expect((updates.meta as { segments: unknown }).segments).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });

  it('clamps a wider-than-list window to the edit list span', () => {
    const updates = buildTimelineClipUpdates({
      clip,
      startTime: 0,
      endTime: 55,
      segments,
      mediaDuration: 60,
      title: '',
      color: 'bg-blue-600',
      gain: 1,
    });

    expect(updates.start).toBe(0);
    expect(updates.end).toBe(30);
    expect(updates.duration).toBe(20);
  });

  it('writes the plain trim window when there is no edit list', () => {
    const updates = buildTimelineClipUpdates({
      clip,
      startTime: 2,
      endTime: 8,
      segments: null,
      mediaDuration: 60,
      title: '',
      color: 'bg-blue-600',
      gain: 1,
    });

    expect(updates).toEqual({
      start: 2,
      end: 8,
      duration: 6,
      meta: {
        mediaMissing: false,
        title: '',
        color: 'bg-blue-600',
        gain: 1,
      },
    });
  });
});
