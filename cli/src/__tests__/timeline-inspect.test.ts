import { describe, expect, it, vi } from 'vitest';
import {
  clipLabelDetail,
  getTimelineOverview,
  inspectAtTime,
  overlapClusters,
  trackGaps,
  type InspectClipInfo,
} from '../lib/timeline-inspect.js';
import type { TimelineClipExpanded } from '../lib/timeline-clip.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

/** getList stub returning the given items for every query. */
function listStub(items: unknown[] = []) {
  return {
    getList: vi.fn(
      async (
        _page: number,
        _perPage: number,
        _opts: { filter?: string; sort?: string; expand?: string }
      ) => listResult(items)
    ),
  };
}

/** Empty stubs for all 8 label collections (override per test). */
function allLabelCollections(overrides: Record<string, Stub> = {}) {
  return {
    LabelObjects: listStub(),
    LabelShots: listStub(),
    LabelPerson: listStub(),
    LabelSpeech: listStub(),
    LabelSpeaker: listStub(),
    LabelFaces: listStub(),
    LabelSegments: listStub(),
    LabelText: listStub(),
    ...overrides,
  };
}

interface StubOptions {
  tracks?: Record<string, unknown>[];
  clips?: Record<string, unknown>[];
  timeline?: Record<string, unknown> | null;
}

function inspectStubs(opts: StubOptions = {}): Record<string, Stub> {
  const {
    tracks = [
      {
        id: 'trk0',
        layer: 0,
        name: 'Music',
        TimelineRef: 'tl1',
        volume: 0.4,
        opacity: 1,
        isMuted: false,
        isLocked: false,
      },
      {
        id: 'trk1',
        layer: 1,
        name: 'B-Roll',
        TimelineRef: 'tl1',
        volume: 1,
        opacity: 1,
        isMuted: true,
        isLocked: false,
      },
    ],
    clips = [],
    timeline = { id: 'tl1', name: 'Cut', WorkspaceRef: 'ws1', duration: 0 },
  } = opts;
  return {
    Timelines: {
      getOne: vi.fn(async () => {
        if (!timeline) throw notFound();
        return timeline;
      }),
    },
    TimelineTracks: {
      getList: vi.fn(async () => listResult(tracks)),
      getOne: vi.fn(async (id: string) => {
        const track = tracks.find((t) => t.id === id);
        if (!track) throw notFound();
        return track;
      }),
    },
    TimelineClips: { getList: vi.fn(async () => listResult(clips)) },
  };
}

const mediaClip = (over: Record<string, unknown>) => ({
  TimelineRef: 'tl1',
  MediaRef: 'm1',
  order: 0,
  start: 0,
  end: 1,
  duration: 1,
  ...over,
});

describe('getTimelineOverview', () => {
  it('resolves pinned and sequential clips to timeline positions', async () => {
    const stubs = inspectStubs({
      clips: [
        mediaClip({
          id: 'c1',
          TimelineTrackRef: 'trk0',
          timelineStart: 0,
          start: 0,
          end: 10,
        }),
        // sequential: butts against c1's end
        mediaClip({ id: 'c2', TimelineTrackRef: 'trk0', start: 0, end: 2 }),
        // pinned with a gap on the other track
        mediaClip({
          id: 'c3',
          TimelineTrackRef: 'trk1',
          timelineStart: 20,
          start: 0,
          end: 5,
        }),
      ],
    });
    const pb = fakePb(stubs);

    const overview = await getTimelineOverview(pb, 'tl1');

    expect(overview.clipCount).toBe(3);
    expect(overview.computedDuration).toBe(25);
    expect(overview.tracks).toHaveLength(2);
    const [layer0, layer1] = overview.tracks;
    expect(layer0.track?.id).toBe('trk0');
    expect(
      layer0.clips.map((c) => [c.clip.id, c.timelineStart, c.timelineEnd])
    ).toEqual([
      ['c1', 0, 10],
      ['c2', 10, 12],
    ]);
    expect(layer1.clips[0].timelineStart).toBe(20);
  });

  it('marks caption clips and computes label hints', async () => {
    const stubs = inspectStubs({
      clips: [
        {
          id: 'cap1',
          TimelineRef: 'tl1',
          TimelineTrackRef: 'trk1',
          CaptionRef: 'caption1',
          order: 0,
          start: 0,
          end: 3,
          duration: 3,
        },
        mediaClip({
          id: 'c1',
          TimelineTrackRef: 'trk0',
          label: 'Ambient bed',
          timelineStart: 0,
        }),
      ],
    });
    const pb = fakePb(stubs);

    const overview = await getTimelineOverview(pb, 'tl1');

    const [layer0, layer1] = overview.tracks;
    expect(layer0.clips[0].kind).toBe('media');
    expect(layer0.clips[0].labelHint).toBe('Ambient bed');
    expect(layer1.clips[0].kind).toBe('caption');
    expect(layer1.clips[0].labelHint).toBe('Caption');
  });

  it('groups legacy track-less clips under an implicit layer-0 lane', async () => {
    const stubs = inspectStubs({
      tracks: [],
      clips: [mediaClip({ id: 'orphan', start: 0, end: 4 })],
    });
    const pb = fakePb(stubs);

    const overview = await getTimelineOverview(pb, 'tl1');

    expect(overview.tracks).toHaveLength(1);
    expect(overview.tracks[0].track).toBeNull();
    expect(overview.tracks[0].layer).toBe(0);
    expect(overview.tracks[0].clips[0].clip.id).toBe('orphan');
  });

  it('errors on an unknown timeline', async () => {
    const pb = fakePb(inspectStubs({ timeline: null }));
    await expect(getTimelineOverview(pb, 'nope')).rejects.toThrow(
      /timeline not found/i
    );
  });
});

describe('inspectAtTime', () => {
  const clips = [
    mediaClip({
      id: 'c1',
      TimelineTrackRef: 'trk0',
      timelineStart: 0,
      start: 5,
      end: 15,
    }),
    mediaClip({
      id: 'c2',
      TimelineTrackRef: 'trk1',
      timelineStart: 2,
      start: 0,
      end: 6,
    }),
  ];

  it('reports the active clip per track with source time and remaining', async () => {
    const pb = fakePb(inspectStubs({ clips }));

    const result = await inspectAtTime(pb, { timelineId: 'tl1', at: 3 });

    expect(result.tracks).toHaveLength(2);
    const [layer0, layer1] = result.tracks;
    expect(layer0.active?.clip.id).toBe('c1');
    // at t=3 the clip (source 5–15, placed at 0) plays source second 8
    expect(layer0.active?.sourceTime).toBe(8);
    expect(layer0.active?.remaining).toBe(7);
    expect(layer1.active?.clip.id).toBe('c2');
    expect(layer1.isMuted).toBe(true);
  });

  it('treats clip ends as exclusive and reports the next start when idle', async () => {
    const pb = fakePb(inspectStubs({ clips }));

    const result = await inspectAtTime(pb, { timelineId: 'tl1', at: 1 });
    const layer1 = result.tracks[1];
    expect(layer1.active).toBeNull();
    expect(layer1.nextStart).toBe(2);

    const atEnd = await inspectAtTime(pb, { timelineId: 'tl1', at: 8 });
    // c2 occupies [2,8) — at t=8 it is finished
    expect(atEnd.tracks[1].active).toBeNull();
  });

  it('restricts to one track by layer', async () => {
    const pb = fakePb(inspectStubs({ clips }));

    const result = await inspectAtTime(pb, {
      timelineId: 'tl1',
      at: 3,
      track: '1',
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].layer).toBe(1);
  });

  it('returns all-idle rows for an empty timeline', async () => {
    const pb = fakePb(inspectStubs());

    const result = await inspectAtTime(pb, { timelineId: 'tl1', at: 5 });

    expect(result.computedDuration).toBe(0);
    expect(result.tracks.every((t) => t.active === null)).toBe(true);
  });
});

describe('clipLabelDetail', () => {
  it('resolves provenance links and overlapping labels', async () => {
    const erik = { id: 'e1', name: 'Erik', kind: 'person' };
    const speechLabel = {
      id: 'ls1',
      MediaRef: 'm1',
      transcript: 'hello world',
      confidence: 0.9,
      start: 5,
      end: 8,
      expand: { LabelTrackRef: { expand: { EntityRef: erik } } },
    };
    const stubs = {
      ...allLabelCollections({
        LabelSpeech: listStub([speechLabel]),
      }),
      MediaClipLabels: listStub([
        {
          id: 'link1',
          MediaClipRef: 'mc1',
          labelType: 'speech',
          LabelSpeechRef: 'ls1',
          confidence: 0.9,
          expand: { LabelSpeechRef: speechLabel },
        },
      ]),
    };
    const pb = fakePb(stubs);

    const clip = {
      id: 'tc1',
      TimelineRef: 'tl1',
      MediaRef: 'm1',
      MediaClipRef: 'mc1',
      order: 0,
      start: 5,
      end: 15,
      duration: 10,
    } as unknown as TimelineClipExpanded;

    const detail = await clipLabelDetail(pb, clip);

    expect(detail.provenance).toHaveLength(1);
    expect(detail.provenance[0]).toMatchObject({
      type: 'speech',
      labelId: 'ls1',
      confidence: 0.9,
      snippet: 'hello world',
      attributedEntity: {
        id: 'e1',
        name: 'Erik',
        kind: 'person',
        via: 'track',
      },
    });
    const [, , linkOptions] = stubs.MediaClipLabels.getList.mock.calls[0];
    expect(linkOptions.filter).toContain('MediaClipRef = mc1');
    // The link expands ride through to each label's entity link points,
    // skipping LabelTrackRef on the collections that don't have it.
    expect(linkOptions.expand).toContain('LabelSpeechRef');
    expect(linkOptions.expand).toContain(
      'LabelSpeechRef.LabelTrackRef.EntityRef'
    );
    expect(linkOptions.expand).toContain(
      'LabelSpeechRef.LabelEntityRef.EntityRef'
    );
    expect(linkOptions.expand).toContain(
      'LabelShotRef.LabelEntityRef.EntityRef'
    );
    expect(linkOptions.expand).not.toContain('LabelShotRef.LabelTrackRef');
    expect(linkOptions.expand).not.toContain('LabelSegmentRef.LabelTrackRef');

    // overlap query is windowed to the clip's source range
    const speechFilter = stubs.LabelSpeech.getList.mock.calls[0][2].filter;
    expect(speechFilter).toContain('MediaRef = m1');
    expect(speechFilter).toContain('start < 15 && end > 5');
    const overlap = detail.overlapping.find((h) => h.record.id === 'ls1');
    expect(overlap).toBeDefined();
    expect(overlap!.attributedEntity?.name).toBe('Erik');
  });

  it('returns nothing for caption clips', async () => {
    const pb = fakePb({});
    const caption = {
      id: 'tc2',
      TimelineRef: 'tl1',
      CaptionRef: 'cap1',
      order: 0,
      start: 0,
      end: 3,
      duration: 3,
    } as unknown as TimelineClipExpanded;

    const detail = await clipLabelDetail(pb, caption);

    expect(detail.provenance).toEqual([]);
    expect(detail.overlapping).toEqual([]);
  });
});

describe('overlapClusters / trackGaps', () => {
  const placed = (id: string, start: number, end: number): InspectClipInfo =>
    ({
      clip: { id } as InspectClipInfo['clip'],
      timelineStart: start,
      timelineEnd: end,
      labelHint: id,
      kind: 'media',
    }) as InspectClipInfo;

  it('clusters chains of overlapping clips, ignoring touching ones', () => {
    const clips = [
      placed('a', 0, 10),
      placed('b', 5, 12), // overlaps a
      placed('c', 12, 15), // touches b — no overlap
      placed('d', 20, 25),
      placed('e', 24, 26), // overlaps d
    ];
    const clusters = overlapClusters(clips);
    expect(clusters.map((c) => c.map((x) => x.clip.id))).toEqual([
      ['a', 'b'],
      ['d', 'e'],
    ]);
  });

  it('flags the everything-at-zero corruption as one cluster', () => {
    const clips = [placed('a', 0, 10), placed('b', 0, 5), placed('c', 0, 8)];
    expect(overlapClusters(clips)).toHaveLength(1);
    expect(overlapClusters(clips)[0]).toHaveLength(3);
  });

  it('reports gaps between consecutive clips only', () => {
    const clips = [
      placed('a', 0, 10),
      placed('b', 10, 12), // flush
      placed('c', 15, 18), // 3s gap
    ];
    expect(trackGaps(clips)).toEqual([
      { start: 12, end: 15, beforeClipId: 'b', afterClipId: 'c' },
    ]);
  });
});
