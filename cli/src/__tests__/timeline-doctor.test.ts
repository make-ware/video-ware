import { describe, expect, it, vi } from 'vitest';
import { doctorTimeline } from '../lib/timeline-doctor.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

interface StubOptions {
  tracks?: Record<string, unknown>[];
  clips?: Record<string, unknown>[];
  timeline?: Record<string, unknown>;
}

function doctorStubs(opts: StubOptions = {}): Record<string, Stub> {
  const {
    tracks = [
      {
        id: 'trk0',
        layer: 0,
        name: 'Main',
        TimelineRef: 'tl1',
        volume: 1,
        opacity: 1,
        isMuted: false,
        isLocked: false,
      },
    ],
    clips = [],
    timeline = { id: 'tl1', name: 'Cut', WorkspaceRef: 'ws1', duration: 0 },
  } = opts;
  return {
    Timelines: { getOne: vi.fn(async () => timeline) },
    TimelineTracks: { getList: vi.fn(async () => listResult(tracks)) },
    TimelineClips: { getList: vi.fn(async () => listResult(clips)) },
  };
}

const mediaExpand = { MediaRef: { id: 'm1', duration: 60 } };

describe('doctorTimeline', () => {
  it('passes a healthy timeline with no findings', async () => {
    const pb = fakePb(
      doctorStubs({
        clips: [
          {
            id: 'a',
            TimelineTrackRef: 'trk0',
            MediaRef: 'm1',
            order: 0,
            start: 0,
            end: 10,
            duration: 10,
            timelineStart: 0,
            expand: mediaExpand,
          },
          {
            id: 'b',
            TimelineTrackRef: 'trk0',
            MediaRef: 'm1',
            order: 1,
            start: 0,
            end: 5,
            duration: 5,
            timelineStart: 10,
            expand: mediaExpand,
          },
        ],
        timeline: {
          id: 'tl1',
          name: 'Cut',
          WorkspaceRef: 'ws1',
          duration: 15,
        },
      })
    );

    const report = await doctorTimeline(pb, 'tl1');

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.clipCount).toBe(2);
    expect(report.computedDuration).toBe(15);
  });

  it('reports overlaps, dangling refs, stale durations, and gaps', async () => {
    const pb = fakePb(
      doctorStubs({
        clips: [
          {
            id: 'a',
            TimelineTrackRef: 'trk0',
            MediaRef: 'm1',
            order: 0,
            start: 0,
            end: 10,
            duration: 10,
            timelineStart: 0,
            expand: mediaExpand,
          },
          // overlaps a: same track, starts inside a's range
          {
            id: 'b',
            TimelineTrackRef: 'trk0',
            MediaRef: 'm1',
            order: 1,
            start: 0,
            end: 5,
            duration: 5,
            timelineStart: 5,
            expand: mediaExpand,
          },
          // dangling media (no expand) + stale stored duration (4 ≠ 5)
          {
            id: 'c',
            TimelineTrackRef: 'trk0',
            MediaRef: 'm-gone',
            order: 2,
            start: 0,
            end: 5,
            duration: 4,
            timelineStart: 20,
          },
          // dangling caption (no expand)
          {
            id: 'd',
            TimelineTrackRef: 'trk0',
            CaptionRef: 'cap-gone',
            order: 3,
            start: 0,
            end: 2,
            duration: 2,
            timelineStart: 30,
          },
        ],
        timeline: {
          id: 'tl1',
          name: 'Cut',
          WorkspaceRef: 'ws1',
          duration: 99,
        },
      })
    );

    const report = await doctorTimeline(pb, 'tl1');

    expect(report.ok).toBe(false);
    expect(report.errors).toBe(3);
    expect(report.warnings).toBe(2);
    expect(report.findings.map((f) => f.code)).toEqual([
      'track-overlap',
      'dangling-media',
      'dangling-caption',
      'stale-clip-duration',
      'stale-timeline-duration',
      'track-gap',
      'track-gap',
    ]);

    const overlap = report.findings[0];
    expect(overlap.level).toBe('error');
    expect(overlap.clipIds).toEqual(['a', 'b']);
    expect(overlap.layer).toBe(0);

    const gaps = report.findings.filter((f) => f.code === 'track-gap');
    expect(gaps[0].clipIds).toEqual(['a', 'c']); // 10s–20s
    expect(gaps[1].clipIds).toEqual(['c', 'd']); // 25s–30s
  });
});
