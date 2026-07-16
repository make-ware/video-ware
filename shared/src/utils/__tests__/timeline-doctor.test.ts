import { describe, it, expect } from 'vitest';
import type { TimelineClip } from '../../schema/timeline-clip.js';
import type { TimelineTrackRecord } from '../../schema/timeline-track.js';
import {
  analyzeTrackJunctions,
  clusterOverlappingRanges,
  collectTimelineDoctorFindings,
  findRangeGaps,
  sortDoctorFindings,
  summarizeDoctorFindings,
} from '../timeline-doctor.js';
import { buildPlaybackTracks } from '../timeline-placement.js';

const mediaExpand = { MediaRef: { id: 'm1', duration: 60 } };

function makeClip(
  overrides: Partial<TimelineClip> & { id: string }
): TimelineClip {
  return {
    collectionId: 'timelineclips',
    collectionName: 'TimelineClips',
    created: '',
    updated: '',
    TimelineRef: 'tl-1',
    MediaRef: 'm1',
    order: 0,
    start: 0,
    end: 1,
    duration: 1,
    expand: mediaExpand,
    ...overrides,
  } as TimelineClip;
}

function makeTrack(
  overrides: Partial<TimelineTrackRecord> & { id: string }
): TimelineTrackRecord {
  return {
    collectionId: 'timelinetracks',
    collectionName: 'TimelineTracks',
    created: '',
    updated: '',
    TimelineRef: 'tl-1',
    layer: 0,
    volume: 1,
    opacity: 1,
    isMuted: false,
    isLocked: false,
    ...overrides,
  } as TimelineTrackRecord;
}

const tracks = [makeTrack({ id: 'trk0' })];

function placedOf(clips: TimelineClip[]) {
  const track = buildPlaybackTracks(clips, tracks)[0];
  return [...track.mediaClips, ...track.captionClips, ...track.timelineClips];
}

describe('clusterOverlappingRanges / findRangeGaps', () => {
  const rangeOf = (r: { start: number; end: number }) => r;

  it('clusters transitively overlapping ranges and drops singletons', () => {
    const items = [
      { id: 'a', start: 0, end: 10 },
      { id: 'b', start: 5, end: 8 },
      { id: 'c', start: 9, end: 12 },
      { id: 'd', start: 20, end: 25 },
    ];
    const clusters = clusterOverlappingRanges(items, rangeOf);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('finds gaps using the furthest end so nested ranges do not fabricate gaps', () => {
    const items = [
      { id: 'a', start: 0, end: 10 },
      { id: 'b', start: 2, end: 4 },
      { id: 'c', start: 15, end: 20 },
    ];
    const gaps = findRangeGaps(items, rangeOf);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ start: 10, end: 15 });
    expect(gaps[0].before.id).toBe('a');
    expect(gaps[0].after.id).toBe('c');
  });
});

describe('analyzeTrackJunctions', () => {
  it('classifies continuous joins, hard cuts, and micro-gaps', () => {
    const clips = [
      // a|b: same media, b resumes exactly at a's source out-point → continuous
      makeClip({ id: 'a', start: 0, end: 10, duration: 10, timelineStart: 0 }),
      makeClip({
        id: 'b',
        start: 10,
        end: 15,
        duration: 5,
        timelineStart: 10,
      }),
      // b|c: touching on the timeline but the source jumps → hard cut
      makeClip({
        id: 'c',
        start: 40,
        end: 45,
        duration: 5,
        timelineStart: 15,
      }),
      // c|d: 30ms sliver → micro-gap
      makeClip({
        id: 'd',
        start: 0,
        end: 5,
        duration: 5,
        timelineStart: 20.03,
      }),
      // d|e: a real 5s gap → not a junction
      makeClip({ id: 'e', start: 0, end: 5, duration: 5, timelineStart: 30 }),
    ];

    const junctions = analyzeTrackJunctions(placedOf(clips));

    expect(junctions).toHaveLength(3);
    expect(junctions[0]).toMatchObject({
      kind: 'continuous',
      time: 10,
      beforeClipId: 'a',
      afterClipId: 'b',
    });
    expect(junctions[1]).toMatchObject({
      kind: 'touching',
      time: 15,
      beforeClipId: 'b',
      afterClipId: 'c',
    });
    expect(junctions[2]).toMatchObject({
      kind: 'micro-gap',
      beforeClipId: 'c',
      afterClipId: 'd',
    });
    expect(junctions[2].gap).toBeCloseTo(0.03, 5);
  });

  it('treats different media touching as a cut, not continuous', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, end: 10, duration: 10, timelineStart: 0 }),
      makeClip({
        id: 'b',
        MediaRef: 'm2',
        start: 10,
        end: 15,
        duration: 5,
        timelineStart: 10,
      }),
    ];
    expect(analyzeTrackJunctions(placedOf(clips))[0].kind).toBe('touching');
  });

  it('respects overlaps: no junction where clips overlap', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, end: 10, duration: 10, timelineStart: 0 }),
      makeClip({ id: 'b', start: 0, end: 5, duration: 5, timelineStart: 5 }),
    ];
    expect(analyzeTrackJunctions(placedOf(clips))).toEqual([]);
  });
});

describe('collectTimelineDoctorFindings', () => {
  it('returns no findings for a healthy timeline', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, end: 10, duration: 10, timelineStart: 0 }),
      makeClip({ id: 'b', start: 0, end: 5, duration: 5, timelineStart: 10 }),
    ];
    const findings = collectTimelineDoctorFindings({
      clips,
      tracks,
      storedDuration: 15,
    });
    expect(findings).toEqual([]);
  });

  it('reports overlaps, micro-gaps, gaps, stale and dangling issues', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, end: 10, duration: 10, timelineStart: 0 }),
      // overlaps a
      makeClip({ id: 'b', start: 0, end: 5, duration: 5, timelineStart: 5 }),
      // 50ms micro-gap after b (b ends at 10)
      makeClip({
        id: 'c',
        start: 0,
        end: 5,
        duration: 4, // stale: effective is 5
        timelineStart: 10.05,
        MediaRef: 'm-gone',
        expand: undefined,
      }),
      // ordinary 4.95s gap after c (c ends at 15.05)
      makeClip({
        id: 'd',
        MediaRef: undefined,
        CaptionRef: 'cap-gone',
        start: 0,
        end: 2,
        duration: 2,
        timelineStart: 20,
        expand: undefined,
      }),
    ];

    const findings = collectTimelineDoctorFindings({
      clips,
      tracks,
      storedDuration: 99,
    });

    expect(findings.map((f) => f.code)).toEqual([
      'track-overlap',
      'micro-gap',
      'track-gap',
      'stale-clip-duration',
      'dangling-media',
      'dangling-caption',
      'stale-timeline-duration',
    ]);

    // a and b both end at 10s; the furthest-end rule keeps a as the gap's
    // "before" clip on ties.
    const microGap = findings.find((f) => f.code === 'micro-gap');
    expect(microGap).toMatchObject({
      level: 'warning',
      layer: 0,
      clipIds: ['a', 'c'],
    });
    expect(microGap?.start).toBeCloseTo(10, 5);
    expect(microGap?.end).toBeCloseTo(10.05, 5);

    const sorted = sortDoctorFindings(findings);
    expect(sorted.map((f) => f.level)).toEqual([
      'error',
      'error',
      'error',
      'warning',
      'warning',
      'warning',
      'info',
    ]);

    const summary = summarizeDoctorFindings(sorted);
    expect(summary).toEqual({ errors: 3, warnings: 3, infos: 1, ok: false });
  });

  it('does not flag composite clips whose stored duration is the segment sum', () => {
    const clips = [
      makeClip({
        id: 'comp',
        start: 0,
        end: 10,
        duration: 6, // segments below sum to 6s of effective content
        timelineStart: 0,
        meta: {
          segments: [
            { start: 0, end: 3 },
            { start: 7, end: 10 },
          ],
        },
      }),
    ];
    const findings = collectTimelineDoctorFindings({ clips, tracks });
    expect(findings.filter((f) => f.code === 'stale-clip-duration')).toEqual(
      []
    );
  });

  it('skips the stored-duration check when storedDuration is omitted', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, end: 10, duration: 10, timelineStart: 0 }),
    ];
    const findings = collectTimelineDoctorFindings({ clips, tracks });
    expect(
      findings.filter((f) => f.code === 'stale-timeline-duration')
    ).toEqual([]);
  });
});
