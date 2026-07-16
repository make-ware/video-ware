import { describe, it, expect } from 'vitest';
import type { TimelineClip } from '../../schema/timeline-clip';
import type { TimelineTrackRecord } from '../../schema/timeline-track';
import type { NestedTimelineData, NestedTimelineMap } from '../nested-timeline';
import {
  MIN_NESTED_WINDOW,
  applyReflowPlanToClips,
  planTimelineReflow,
  planTimelineTreeReflow,
} from '../timeline-reflow';

function makeClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    TimelineRef: 'timeline1',
    order: 0,
    start: 0,
    end: 0,
    duration: 0,
    ...overrides,
  } as unknown as TimelineClip;
}

function makeTrack(
  overrides: Partial<TimelineTrackRecord>
): TimelineTrackRecord {
  return {
    id: 'track',
    TimelineRef: 'timeline1',
    layer: 0,
    volume: 1,
    opacity: 1,
    isMuted: false,
    isLocked: false,
    ...overrides,
  } as unknown as TimelineTrackRecord;
}

/** A child timeline whose playback extent is exactly `extent` seconds. */
function childOfExtent(extent: number, idPrefix = 'sub'): NestedTimelineData {
  return {
    clips: [
      makeClip({
        id: `${idPrefix}-media`,
        MediaRef: 'media1',
        TimelineTrackRef: `${idPrefix}-t0`,
        start: 0,
        end: extent,
        duration: extent,
        timelineStart: 0,
      }),
    ],
    tracks: [makeTrack({ id: `${idPrefix}-t0`, layer: 0 })],
  };
}

const track = makeTrack({ id: 't0', layer: 0 });

function changeFor(
  plan: { changes: { clipId: string }[] },
  clipId: string
): Record<string, unknown> | undefined {
  return plan.changes.find((c) => c.clipId === clipId) as
    | Record<string, unknown>
    | undefined;
}

describe('planTimelineReflow', () => {
  it('grows a follow-source clip and shifts downstream clips preserving 0s and 2s gaps', () => {
    // nested [0..8] stale (child now 10), title A flush at 8 (0s gap),
    // title B at 13 (2s gap after A ends at 11).
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: true },
      }),
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 8,
      }),
      makeClip({
        id: 'b',
        CaptionRef: 'cap-b',
        TimelineTrackRef: 't0',
        start: 0,
        end: 2,
        duration: 2,
        timelineStart: 13,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    expect(changeFor(plan, 'n1')).toMatchObject({
      timelineStart: 0,
      start: 0,
      end: 10,
      duration: 10,
    });
    expect(changeFor(plan, 'a')).toMatchObject({ timelineStart: 10 });
    expect(changeFor(plan, 'b')).toMatchObject({ timelineStart: 15 });
  });

  it('shrinks a follow-source clip and shifts downstream clips left', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(6) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 10,
        duration: 10,
        timelineStart: 0,
        meta: { followSource: true },
      }),
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 12,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    expect(changeFor(plan, 'n1')).toMatchObject({ end: 6, duration: 6 });
    // 2s gap (10 → 12) preserved after the new end at 6.
    expect(changeFor(plan, 'a')).toMatchObject({ timelineStart: 8 });
  });

  it('leaves a trimmed clip untouched when the child grows', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(20) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 2,
        end: 8,
        duration: 6,
        timelineStart: 0,
        meta: { followSource: false },
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);
    expect(plan.changes).toEqual([]);
  });

  it('tail-clamps a trimmed window past a shrunk child and shifts downstream left', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(7) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 2,
        end: 10,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: false },
      }),
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 8,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    // Window [2,10) clamps to [2,7); in-point kept, no out-of-range flag.
    const n1 = changeFor(plan, 'n1');
    expect(n1).toMatchObject({ start: 2, end: 7, duration: 5 });
    expect(n1?.meta).toBeUndefined();
    expect(changeFor(plan, 'a')).toMatchObject({ timelineStart: 5 });
  });

  it('clamps a window wholly beyond the child to its tail and flags sourceOutOfRange', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(5) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 9,
        end: 12,
        duration: 3,
        timelineStart: 0,
        meta: { followSource: false },
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    expect(changeFor(plan, 'n1')).toMatchObject({
      start: 5 - MIN_NESTED_WINDOW,
      end: 5,
      duration: MIN_NESTED_WINDOW,
      meta: { followSource: false, sourceOutOfRange: true },
    });
  });

  it('reflows tracks independently', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const otherTrack = makeTrack({ id: 't1', layer: 1 });
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: true },
      }),
      makeClip({
        id: 'other',
        CaptionRef: 'cap',
        TimelineTrackRef: 't1',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 8,
      }),
    ];

    const plan = planTimelineReflow(clips, [track, otherTrack], nested);

    expect(changeFor(plan, 'n1')).toBeDefined();
    expect(changeFor(plan, 'other')).toBeUndefined();
  });

  it('is idempotent: re-planning after apply yields no changes', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: true },
      }),
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 8,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);
    expect(plan.changes.length).toBeGreaterThan(0);

    const healed = applyReflowPlanToClips(clips, plan);
    const replan = planTimelineReflow(healed, [track], nested);
    expect(replan.changes).toEqual([]);
  });

  it('promotes a legacy full-span clip to follow-source (stale-long window)', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(7) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 10, // frozen at insert; child has since shrunk to 7
        duration: 10,
        timelineStart: 0,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    expect(changeFor(plan, 'n1')).toMatchObject({
      start: 0,
      end: 7,
      duration: 7,
      meta: { followSource: true },
    });
  });

  it('stamps followSource without moving anything when the window already matches', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 10,
        duration: 10,
        timelineStart: 0,
      }),
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 10,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    // Meta-only stamp; no timelineStart pins cascade from it.
    expect(plan.changes).toEqual([
      { clipId: 'n1', meta: { followSource: true } },
    ]);
  });

  it('does not promote legacy clips when promotion is disabled', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(7) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 10,
        duration: 10,
        timelineStart: 0,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested, {
      promoteLegacyFullSpan: false,
    });

    // Still tail-clamped (treated as trimmed) but no follow flag.
    const n1 = changeFor(plan, 'n1');
    expect(n1).toMatchObject({ start: 0, end: 7, duration: 7 });
    expect(n1?.meta).toBeUndefined();
  });

  it('does not grow a legacy short-window clip (ambiguous with a deliberate trim)', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8, // below the live extent — could be a deliberate end trim
        duration: 8,
        timelineStart: 0,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);
    expect(plan.changes).toEqual([]);
  });

  it('pins previously sequential clips with explicit timelineStart from the first change', () => {
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        meta: { followSource: true },
        // no timelineStart — sequential at 0
      }),
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        // no timelineStart — sequential after n1 (at 8)
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    expect(changeFor(plan, 'n1')).toMatchObject({ timelineStart: 0, end: 10 });
    expect(changeFor(plan, 'a')).toMatchObject({ timelineStart: 10 });
  });

  it('leaves clips whose child data is missing untouched', () => {
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'gone',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: true },
      }),
    ];

    const plan = planTimelineReflow(clips, [track], {});
    expect(plan.changes).toEqual([]);
  });

  it('leaves clips of an emptied child untouched', () => {
    const nested: NestedTimelineMap = { sub: { clips: [], tracks: [] } };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: true },
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);
    expect(plan.changes).toEqual([]);
  });

  it('leaves pre-existing overlaps untouched when nothing drifted', () => {
    const nested: NestedTimelineMap = {};
    const clips = [
      makeClip({
        id: 'a',
        CaptionRef: 'cap-a',
        TimelineTrackRef: 't0',
        start: 0,
        end: 5,
        duration: 5,
        timelineStart: 0,
      }),
      makeClip({
        id: 'b',
        CaptionRef: 'cap-b',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 4, // overlaps a by 1s — deliberate or legacy, not drift
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);
    expect(plan.changes).toEqual([]);
  });

  it('preserves a pre-existing overlap when upstream drift shifts the track', () => {
    // n1 grows 8 → 10; b starts at 7, overlapping n1's old end by 1s. The
    // negative gap is preserved: b shifts to 9, still overlapping by 1s.
    const nested: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 8,
        duration: 8,
        timelineStart: 0,
        meta: { followSource: true },
      }),
      makeClip({
        id: 'b',
        CaptionRef: 'cap-b',
        TimelineTrackRef: 't0',
        start: 0,
        end: 3,
        duration: 3,
        timelineStart: 7,
      }),
    ];

    const plan = planTimelineReflow(clips, [track], nested);

    expect(changeFor(plan, 'n1')).toMatchObject({ end: 10, duration: 10 });
    expect(changeFor(plan, 'b')).toMatchObject({ timelineStart: 9 });
  });
});

describe('planTimelineTreeReflow', () => {
  it('propagates grandchild growth to the parent through healed extents', () => {
    // leaf grew to 10; mid's follow clip is stale at 6; root's follow clip
    // of mid is stale at 6 too. Healing bottom-up: mid extent becomes 10,
    // so the root clip heals against 10, not 6.
    const nestedTimelines: NestedTimelineMap = {
      mid: {
        clips: [
          makeClip({
            id: 'mid-n1',
            SourceTimelineRef: 'leaf',
            TimelineTrackRef: 'mid-t0',
            start: 0,
            end: 6,
            duration: 6,
            timelineStart: 0,
            meta: { followSource: true },
          }),
        ],
        tracks: [makeTrack({ id: 'mid-t0', layer: 0 })],
      },
      leaf: childOfExtent(10, 'leaf'),
    };
    const rootClips = [
      makeClip({
        id: 'root-n1',
        SourceTimelineRef: 'mid',
        TimelineTrackRef: 't0',
        start: 0,
        end: 6,
        duration: 6,
        timelineStart: 0,
        meta: { followSource: true },
      }),
      makeClip({
        id: 'root-title',
        CaptionRef: 'cap',
        TimelineTrackRef: 't0',
        start: 0,
        end: 2,
        duration: 2,
        timelineStart: 6,
      }),
    ];

    const result = planTimelineTreeReflow({
      rootTimelineId: 'root',
      clips: rootClips,
      tracks: [track],
      nestedTimelines,
    });

    expect(result.hasDrift).toBe(true);
    expect(changeFor(result.nested['mid'], 'mid-n1')).toMatchObject({
      end: 10,
      duration: 10,
    });
    expect(changeFor(result.root, 'root-n1')).toMatchObject({
      end: 10,
      duration: 10,
    });
    expect(changeFor(result.root, 'root-title')).toMatchObject({
      timelineStart: 10,
    });

    // In-memory application is reflected for callers that keep working
    // with the healed data.
    const healedRootClip = result.updatedClips.find((c) => c.id === 'root-n1');
    expect(healedRootClip?.end).toBe(10);
    const healedMid = result.updatedNested['mid'].clips[0];
    expect(healedMid.end).toBe(10);
  });

  it('reports no drift for a clean tree', () => {
    const nestedTimelines: NestedTimelineMap = { sub: childOfExtent(10) };
    const clips = [
      makeClip({
        id: 'n1',
        SourceTimelineRef: 'sub',
        TimelineTrackRef: 't0',
        start: 0,
        end: 10,
        duration: 10,
        timelineStart: 0,
        meta: { followSource: true },
      }),
    ];

    const result = planTimelineTreeReflow({
      rootTimelineId: 'root',
      clips,
      tracks: [track],
      nestedTimelines,
    });

    expect(result.hasDrift).toBe(false);
    expect(result.root.changes).toEqual([]);
    expect(result.updatedClips).toBe(clips);
  });
});
