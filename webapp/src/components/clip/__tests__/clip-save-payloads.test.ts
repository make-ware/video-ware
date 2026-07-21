import { describe, it, expect } from 'vitest';
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
  it('writes derived times + merged clipData without ever touching type', () => {
    const patch = buildMediaClipSegmentsPatch({
      clip: {
        clipData: { gapThreshold: 2 },
      },
      segments,
      mediaDuration: 60,
    });

    // composite-ness is the edit list itself — no type key, ever
    expect(patch).toEqual({
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

  it('collapses a 1-segment list: start/end become the source of truth', () => {
    const patch = buildMediaClipSegmentsPatch({
      clip: { clipData: { gapThreshold: 2, segments } },
      segments: [{ start: 5, end: 25 }],
      mediaDuration: 60,
    });

    expect(patch).toEqual({
      start: 5,
      end: 25,
      duration: 20,
      clipData: { gapThreshold: 2 }, // segments key removed
    });
  });

  it('collapses when clamping to the media duration leaves one segment', () => {
    const patch = buildMediaClipSegmentsPatch({
      clip: { clipData: {} },
      segments: [
        { start: 20, end: 99 },
        { start: 30, end: 99 },
      ],
      mediaDuration: 25,
    });
    // both clamp to <=25; overlap merges into one segment → collapse
    expect(patch).toEqual({
      start: 20,
      end: 25,
      duration: 5,
      clipData: {},
    });
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

  it('collapses a 1-segment list when the source has no edit list', () => {
    const withOldList = {
      meta: { gain: 0.5, segments },
    } as unknown as Pick<ExpandedTimelineClip, 'meta'>;

    const updates = buildTimelineClipUpdates({
      clip: withOldList,
      startTime: 0,
      endTime: 30,
      segments: [{ start: 0, end: 30 }],
      sourceHasActiveEditList: false,
      mediaDuration: 60,
      title: '',
      color: 'bg-blue-600',
      gain: 1,
    });

    expect(updates).toEqual({
      start: 0,
      end: 30,
      duration: 30,
      // segments key removed — the clip is plain again
      meta: { gain: 1, title: '', color: 'bg-blue-600' },
    });
  });

  it('keeps a 1-segment override as a mask over a composite source', () => {
    const updates = buildTimelineClipUpdates({
      clip,
      startTime: 0,
      endTime: 30,
      segments: [{ start: 0, end: 30 }],
      sourceHasActiveEditList: true,
      mediaDuration: 60,
      title: '',
      color: 'bg-blue-600',
      gain: 1,
    });

    // removing it would unmask the source MediaClip's cuts
    expect((updates.meta as { segments: unknown }).segments).toEqual([
      { start: 0, end: 30 },
    ]);
    expect(updates.duration).toBe(30);
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

  it('drops a stale meta.segments key when saving as plain', () => {
    const withStale = {
      meta: { gain: 0.5, segments },
    } as unknown as Pick<ExpandedTimelineClip, 'meta'>;

    const updates = buildTimelineClipUpdates({
      clip: withStale,
      startTime: 2,
      endTime: 8,
      segments: null,
      mediaDuration: 60,
      title: '',
      color: 'bg-blue-600',
      gain: 1,
    });

    expect(updates.meta).toEqual({ gain: 1, title: '', color: 'bg-blue-600' });
  });
});
