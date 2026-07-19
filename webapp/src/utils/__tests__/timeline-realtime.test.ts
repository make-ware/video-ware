import { describe, it, expect } from 'vitest';
import type {
  Timeline,
  TimelineClip,
  TimelineTrackRecord,
} from '@project/shared';
import type { TimelineWithClips } from '@/services/timeline';
import {
  applyClipEvent,
  applyTrackEvent,
  applyTimelineEvent,
  isRecordNewer,
} from '../timeline-realtime';

const T0 = '2026-07-18 10:00:00.000Z';
const T1 = '2026-07-18 10:00:01.000Z';
const T2 = '2026-07-18 10:00:02.000Z';

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-a',
    TimelineRef: 'tl-1',
    order: 0,
    start: 0,
    end: 1,
    duration: 1,
    created: T0,
    updated: T0,
    ...overrides,
  } as TimelineClip;
}

function makeTrack(
  overrides: Partial<TimelineTrackRecord> = {}
): TimelineTrackRecord {
  return {
    id: 'track-a',
    TimelineRef: 'tl-1',
    name: 'Main Track',
    layer: 0,
    created: T0,
    updated: T0,
    ...overrides,
  } as TimelineTrackRecord;
}

function makeTimeline(
  overrides: Partial<TimelineWithClips> = {}
): TimelineWithClips {
  return {
    id: 'tl-1',
    name: 'My timeline',
    duration: 0,
    version: 1,
    created: T0,
    updated: T0,
    clips: [],
    tracks: [makeTrack()],
    nestedTimelines: {},
    ...overrides,
  } as unknown as TimelineWithClips;
}

describe('isRecordNewer', () => {
  it('is true only for strictly newer stamps', () => {
    expect(isRecordNewer({ updated: T1 }, { updated: T0 })).toBe(true);
    expect(isRecordNewer({ updated: T0 }, { updated: T0 })).toBe(false);
    expect(isRecordNewer({ updated: T0 }, { updated: T1 })).toBe(false);
  });

  it('fails open when either stamp is missing', () => {
    expect(isRecordNewer({}, { updated: T0 })).toBe(true);
    expect(isRecordNewer({ updated: T0 }, {})).toBe(true);
  });
});

describe('applyClipEvent', () => {
  it('inserts a created clip sorted by order', () => {
    const timeline = makeTimeline({
      clips: [makeClip({ id: 'clip-a', order: 0 })],
    });
    const incoming = makeClip({ id: 'clip-b', order: 0.5, updated: T1 });

    const next = applyClipEvent(timeline, 'create', incoming);

    expect(next).not.toBe(timeline);
    expect(next.clips.map((c) => c.id)).toEqual(['clip-a', 'clip-b']);
  });

  it('ignores creates for other timelines', () => {
    const timeline = makeTimeline();
    const incoming = makeClip({ id: 'clip-x', TimelineRef: 'tl-other' });

    expect(applyClipEvent(timeline, 'create', incoming)).toBe(timeline);
  });

  it('returns the same reference for the echo of an already-applied write', () => {
    const clip = makeClip({ updated: T1 });
    const timeline = makeTimeline({ clips: [clip] });

    expect(applyClipEvent(timeline, 'update', { ...clip })).toBe(timeline);
  });

  it('drops stale out-of-order updates', () => {
    const clip = makeClip({ updated: T1, start: 5 });
    const timeline = makeTimeline({ clips: [clip] });
    const stale = makeClip({ updated: T0, start: 99 });

    expect(applyClipEvent(timeline, 'update', stale)).toBe(timeline);
    expect(timeline.clips[0].start).toBe(5);
  });

  it('applies newer updates in place', () => {
    const timeline = makeTimeline({
      clips: [makeClip({ order: 0 }), makeClip({ id: 'clip-b', order: 1 })],
    });
    const incoming = makeClip({ start: 2, end: 4, updated: T1 });

    const next = applyClipEvent(timeline, 'update', incoming);

    expect(next.clips.map((c) => c.id)).toEqual(['clip-a', 'clip-b']);
    expect(next.clips[0].start).toBe(2);
  });

  it('re-sorts when an update changes order', () => {
    const timeline = makeTimeline({
      clips: [makeClip({ order: 0 }), makeClip({ id: 'clip-b', order: 1 })],
    });
    const incoming = makeClip({ order: 2, updated: T1 });

    const next = applyClipEvent(timeline, 'update', incoming);

    expect(next.clips.map((c) => c.id)).toEqual(['clip-b', 'clip-a']);
  });

  it('treats an update for an unknown clip as a missed create', () => {
    const timeline = makeTimeline({ clips: [makeClip()] });
    const incoming = makeClip({ id: 'clip-new', order: 1, updated: T1 });

    const next = applyClipEvent(timeline, 'update', incoming);

    expect(next.clips.map((c) => c.id)).toEqual(['clip-a', 'clip-new']);
  });

  it('removes a clip whose update moved it to another timeline', () => {
    const timeline = makeTimeline({ clips: [makeClip()] });
    const incoming = makeClip({ TimelineRef: 'tl-other', updated: T1 });

    const next = applyClipEvent(timeline, 'update', incoming);

    expect(next.clips).toHaveLength(0);
  });

  it('removes deleted clips and no-ops on unknown deletions', () => {
    const timeline = makeTimeline({ clips: [makeClip()] });

    const next = applyClipEvent(timeline, 'delete', makeClip());
    expect(next.clips).toHaveLength(0);

    expect(applyClipEvent(next, 'delete', makeClip())).toBe(next);
  });
});

describe('applyTrackEvent', () => {
  it('inserts created tracks sorted by layer', () => {
    const timeline = makeTimeline({ tracks: [makeTrack({ layer: 1 })] });
    const incoming = makeTrack({ id: 'track-b', layer: 0, updated: T1 });

    const next = applyTrackEvent(timeline, 'create', incoming);

    expect(next.tracks.map((t) => t.id)).toEqual(['track-b', 'track-a']);
  });

  it('drops echoes and stale updates by reference', () => {
    const track = makeTrack({ updated: T1 });
    const timeline = makeTimeline({ tracks: [track] });

    expect(applyTrackEvent(timeline, 'update', { ...track })).toBe(timeline);
    expect(
      applyTrackEvent(timeline, 'update', makeTrack({ updated: T0 }))
    ).toBe(timeline);
  });

  it('applies newer updates and removes deletions', () => {
    const timeline = makeTimeline({ tracks: [makeTrack()] });
    const renamed = makeTrack({ name: 'B-roll', updated: T1 });

    const next = applyTrackEvent(timeline, 'update', renamed);
    expect(next.tracks[0].name).toBe('B-roll');

    const gone = applyTrackEvent(next, 'delete', renamed);
    expect(gone.tracks).toHaveLength(0);
  });
});

describe('applyTimelineEvent', () => {
  it('merges newer scalar fields and keeps composite fields from the cache', () => {
    const timeline = makeTimeline({ clips: [makeClip()] });
    const incoming = {
      id: 'tl-1',
      name: 'Renamed',
      duration: 42,
      version: 3,
      updated: T2,
    } as unknown as Timeline;

    const next = applyTimelineEvent(timeline, 'update', incoming);

    expect(next.name).toBe('Renamed');
    expect(next.version).toBe(3);
    expect(next.clips).toBe(timeline.clips);
    expect(next.tracks).toBe(timeline.tracks);
    expect(next.nestedTimelines).toBe(timeline.nestedTimelines);
  });

  it('preserves the cached name while a local rename is in flight', () => {
    const timeline = makeTimeline({ name: 'Local draft name' });
    const incoming = {
      id: 'tl-1',
      name: 'Remote rename',
      updated: T2,
    } as unknown as Timeline;

    const next = applyTimelineEvent(timeline, 'update', incoming, {
      preserveName: true,
    });

    expect(next.name).toBe('Local draft name');
    expect(String(next.updated)).toBe(T2);
  });

  it('ignores echoes, other timelines, and delete actions', () => {
    const timeline = makeTimeline({ updated: T1 });

    expect(
      applyTimelineEvent(timeline, 'update', {
        id: 'tl-1',
        updated: T1,
      } as unknown as Timeline)
    ).toBe(timeline);
    expect(
      applyTimelineEvent(timeline, 'update', {
        id: 'tl-other',
        updated: T2,
      } as unknown as Timeline)
    ).toBe(timeline);
    expect(
      applyTimelineEvent(timeline, 'delete', {
        id: 'tl-1',
        updated: T2,
      } as unknown as Timeline)
    ).toBe(timeline);
  });
});
