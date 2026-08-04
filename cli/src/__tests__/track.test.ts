import { describe, it, expect, vi } from 'vitest';
import { fakePb, listResult, type Stub } from './fake-pb.js';
import { captureList } from './list-harness.js';
import { resolveListQuery } from '../lib/list/query.js';
import {
  DEFAULT_MAX_FRAMES,
  budgetExceededMessage,
  csvHeader,
  csvLine,
  estimateExportFrames,
  exportRow,
  fetchExportTracks,
  fetchKeyframes,
  fetchTrackPage,
  filterByRegion,
  getTrackDigest,
  getTracksAt,
  parseExportFormat,
  parseRegion,
  parseTrackType,
  prepareFrames,
  trackFrameCount,
  trackListSpec,
  trackMotion,
  trackSubject,
  trackUnionBox,
  TRACK_EXPORT_DEFAULTS,
  type TrackExportOptions,
  type TrackRecord,
} from '../lib/track.js';

/** An 8 fps run of `count` frames, drifting right and growing. */
function frames(count: number, start = 0) {
  return Array.from({ length: count }, (_, i) => ({
    t: start + i * 0.125,
    bbox: {
      left: 0.1 + i * 0.01,
      top: 0.2,
      right: 0.3 + i * 0.012,
      bottom: 0.4,
    },
    confidence: 0.72,
  }));
}

function makeTrack(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    id: 'lt1',
    WorkspaceRef: 'ws1',
    MediaRef: 'm1',
    LabelEntityRef: 'le1',
    trackId: '4',
    trackHash: 'hash1',
    labelType: 'object',
    start: 5.75,
    end: 9.25,
    duration: 3.5,
    confidence: 0.72,
    trackData: { entity: 'tableware', frameCount: 29 },
    expand: {
      MediaRef: {
        id: 'm1',
        width: 1920,
        height: 1080,
        expand: { UploadRef: { name: 'beach.mp4' } },
      },
      LabelEntityRef: {
        id: 'le1',
        canonicalName: 'tableware',
        expand: { EntityRef: { id: 'e1', name: 'Erik', kind: 'person' } },
      },
    },
    ...overrides,
  } as unknown as TrackRecord;
}

/** Collection stubs with one track and a keyframes payload behind getOne. */
function makeCollections(
  opts: { tracks?: unknown[]; keyframes?: unknown[] } = {}
): Record<string, Stub> {
  const tracks = opts.tracks ?? [makeTrack()];
  return {
    LabelTrack: {
      getList: vi.fn(async () => listResult(tracks)),
      getOne: vi.fn(async (id: string, options: { fields?: string }) =>
        options?.fields === 'id,keyframes'
          ? { id, keyframes: opts.keyframes ?? frames(29, 5.75) }
          : tracks.find((t: any) => t.id === id)
      ),
    },
  };
}

const ctx = (pb: any) => ({ pb, workspaceId: 'ws1' });

describe('parsers', () => {
  it('rejects a label kind that is not a track kind', () => {
    expect(() => parseTrackType('nope')).toThrow(/Invalid track type/);
    expect(parseTrackType('face')).toBe('face');
  });

  it('rejects an unknown export format', () => {
    expect(() => parseExportFormat('parquet')).toThrow(/Invalid format/);
    expect(parseExportFormat('csv')).toBe('csv');
  });

  it('parses a region and rejects an inverted one', () => {
    expect(parseRegion('0.5,0,1,0.5')).toEqual({
      left: 0.5,
      top: 0,
      right: 1,
      bottom: 0.5,
    });
    expect(() => parseRegion('1,0,0.5,0.5')).toThrow(/left < right/);
    expect(() => parseRegion('0,0,1')).toThrow(/left,top,right,bottom/);
  });
});

describe('trackListSpec', () => {
  it('demands a scope rather than offering to scan a workspace', async () => {
    const pb = fakePb(makeCollections());
    await expect(
      resolveListQuery(trackListSpec, {}, ctx(pb), { isTTY: false })
    ).rejects.toThrow(/needs at least one of/);
  });

  it('binds each filter as its own clause', async () => {
    const pb = fakePb(makeCollections());
    const query = await resolveListQuery(
      trackListSpec,
      { media: 'm1', type: 'face', from: 4, to: 12, minConfidence: 0.6 },
      ctx(pb),
      { isTTY: false }
    );
    expect(query.filter).toBe(
      '(WorkspaceRef = ws1) && (MediaRef = m1) && (labelType = face) && ' +
        '(end > 4) && (start < 12) && (confidence >= 0.6)'
    );
  });

  it('uses the standard overlap predicate for --from/--to', async () => {
    const pb = fakePb(makeCollections());
    const query = await resolveListQuery(
      trackListSpec,
      { media: 'm1', from: 10, to: 20 },
      ctx(pb),
      { isTTY: false }
    );
    // A track from 5–15 overlaps [10,20): end > 10 && start < 20.
    expect(query.filter).toContain('end > 10');
    expect(query.filter).toContain('start < 20');
  });
});

describe('fetchTrackPage', () => {
  it('never asks for the keyframes column', async () => {
    const collections = makeCollections();
    const pb = fakePb(collections);
    await fetchTrackPage(pb, {
      page: 1,
      perPage: 50,
      filter: 'MediaRef = m1',
      sort: 'start,MediaRef,id',
    });

    const [, , options] = collections.LabelTrack.getList.mock.calls[0];
    expect(options.fields).toContain('boundingBox');
    expect(options.fields).toContain('trackData');
    expect(options.fields).not.toContain('keyframes');
    // Naming any field strips expands unless their paths are named too.
    expect(options.fields).toContain('expand.MediaRef.*');
    expect(options.fields).toContain(
      'expand.LabelEntityRef.expand.EntityRef.*'
    );
  });

  it('ANDs an entity attribution scope onto the resolved filter', async () => {
    const collections = makeCollections();
    const pb = fakePb(collections);
    await fetchTrackPage(
      pb,
      { page: 1, perPage: 50, filter: 'MediaRef = m1', sort: 'start' },
      'e1'
    );
    const [, , options] = collections.LabelTrack.getList.mock.calls[0];
    expect(options.filter).toBe(
      '(LabelEntityRef.EntityRef = "e1") && (MediaRef = m1)'
    );
  });
});

describe('track list output', () => {
  it('reports frame counts from trackData, having read no keyframes', async () => {
    const collections = makeCollections();
    const pb = fakePb(collections);
    const out = await captureList({
      spec: trackListSpec,
      opts: { media: 'm1' },
      ctx: ctx(pb),
      fetchPage: (query) => fetchTrackPage(pb, query),
      argv: ['track', 'list'],
    });

    expect(out.text).toContain('lt1');
    expect(out.text).toContain('tableware');
    expect(out.text).toContain('Erik');
    expect(out.text).toContain('29');
    expect(collections.LabelTrack.getOne).not.toHaveBeenCalled();
  });

  it('leaves FRAMES blank rather than guessing zero', async () => {
    const collections = makeCollections({
      tracks: [makeTrack({ trackData: { entity: 'tableware' } })],
    });
    const pb = fakePb(collections);
    const out = await captureList({
      spec: trackListSpec,
      opts: { media: 'm1' },
      ctx: ctx(pb),
      fetchPage: (query) => fetchTrackPage(pb, query),
    });
    const row = out.stdout.find((line) => line.includes('lt1')) ?? '';
    expect(row.trimEnd().endsWith('0.72')).toBe(true);
  });
});

describe('filterByRegion', () => {
  const inTopRight = makeTrack({
    id: 'a',
    boundingBox: { left: 0.6, top: 0.1, right: 0.9, bottom: 0.4 },
  } as Partial<TrackRecord>);
  const bottomLeft = makeTrack({
    id: 'b',
    boundingBox: { left: 0.0, top: 0.6, right: 0.2, bottom: 0.9 },
  } as Partial<TrackRecord>);
  const noBox = makeTrack({ id: 'c' });

  it('keeps only tracks whose union box overlaps the region', () => {
    const region = { left: 0.5, top: 0, right: 1, bottom: 0.5 };
    expect(
      filterByRegion([inTopRight, bottomLeft, noBox], region).map((t) => t.id)
    ).toEqual(['a']);
  });

  it('drops tracks with no union box rather than passing them through', () => {
    // A speech track has no geometry, so it cannot be "in" any region.
    const region = { left: 0, top: 0, right: 1, bottom: 1 };
    expect(filterByRegion([noBox], region)).toEqual([]);
  });
});

describe('trackUnionBox', () => {
  it('prefers the stored box over recomputing from frames', () => {
    const stored = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 };
    const track = makeTrack({ boundingBox: stored } as Partial<TrackRecord>);
    expect(trackUnionBox(track, frames(5))).toEqual(stored);
  });

  it('derives the box when the column is empty (rows written before it)', () => {
    const box = trackUnionBox(makeTrack(), frames(3));
    expect(box).toEqual({ left: 0.1, top: 0.2, right: 0.324, bottom: 0.4 });
  });

  it('is null when there is neither a stored box nor a frame', () => {
    expect(trackUnionBox(makeTrack(), [])).toBeNull();
  });
});

describe('trackSubject / trackFrameCount', () => {
  it('reads the provider term, then the speaker id, then the cluster name', () => {
    expect(trackSubject(makeTrack())).toBe('tableware');
    expect(
      trackSubject(makeTrack({ trackData: { speakerId: 'speaker_0' } }))
    ).toBe('speaker_0');
    expect(trackSubject(makeTrack({ trackData: {} }))).toBe('tableware');
  });

  it('returns null for a frame count the provider never wrote', () => {
    expect(trackFrameCount(makeTrack())).toBe(29);
    expect(trackFrameCount(makeTrack({ trackData: {} }))).toBeNull();
  });
});

describe('trackMotion', () => {
  it('describes drift and size change', () => {
    const motion = trackMotion(frames(29));
    expect(motion?.description).toContain('drifts right');
    expect(motion?.description).toContain('grows');
  });

  it('is null for a track that cannot move', () => {
    expect(trackMotion([])).toBeNull();
    expect(trackMotion(frames(1))).toBeNull();
  });

  it('says so when the box holds still', () => {
    const still = [
      { t: 0, bbox: { left: 0.1, top: 0.1, right: 0.2, bottom: 0.2 } },
      { t: 1, bbox: { left: 0.1, top: 0.1, right: 0.2, bottom: 0.2 } },
    ];
    expect(trackMotion(still)?.description).toBe('holds position');
  });
});

describe('getTrackDigest', () => {
  it('samples rather than returning every frame', async () => {
    const pb = fakePb(makeCollections());
    const digest = await getTrackDigest(pb, 'lt1');
    expect(digest.frameCount).toBe(29);
    expect(digest.samples).toHaveLength(12);
    expect(digest.frameRate).toBeCloseTo(29 / 3.5, 5);
    expect(digest.entity?.name).toBe('Erik');
    expect(digest.unionPixels?.left).toBe(192);
  });

  it('honours --frames, and refuses a terminal-flooding count', async () => {
    const pb = fakePb(makeCollections());
    expect(
      (await getTrackDigest(pb, 'lt1', { frames: 5 })).samples
    ).toHaveLength(5);
    await expect(getTrackDigest(pb, 'lt1', { frames: 5000 })).rejects.toThrow(
      /vw track export/
    );
  });

  it('handles a track with no spatial keyframes', async () => {
    const pb = fakePb(makeCollections({ keyframes: [] }));
    const digest = await getTrackDigest(pb, 'lt1');
    expect(digest.frameCount).toBe(0);
    expect(digest.union).toBeNull();
    expect(digest.motion).toBeNull();
    expect(digest.samples).toEqual([]);
  });

  it('fails loudly on an id that is not a track', async () => {
    const pb = fakePb({
      LabelTrack: { getOne: vi.fn(async () => null), getList: vi.fn() },
    });
    await expect(getTrackDigest(pb, 'nope')).rejects.toThrow(/Track not found/);
  });
});

describe('fetchKeyframes', () => {
  it('asks for the id and keyframes and nothing else', async () => {
    const collections = makeCollections();
    const pb = fakePb(collections);
    const kfs = await fetchKeyframes(pb, 'lt1');
    expect(kfs).toHaveLength(29);
    expect(collections.LabelTrack.getOne.mock.calls[0][1].fields).toBe(
      'id,keyframes'
    );
  });
});

describe('getTracksAt', () => {
  it('filters to tracks spanning the instant and interpolates each box', async () => {
    const collections = makeCollections();
    const pb = fakePb(collections);
    const result = await getTracksAt(pb, { mediaId: 'm1', at: 6.0 });

    const [, , options] = collections.LabelTrack.getList.mock.calls[0];
    expect(options.filter).toContain('start <= 6');
    expect(options.filter).toContain('end >= 6');
    expect(options.filter).toContain('MediaRef = m1');
    expect(result.hits).toHaveLength(1);
    expect(result.frame).toEqual({ width: 1920, height: 1080 });
    expect(result.hits[0].pixels).not.toBeNull();
  });

  it('counts, rather than shows, live tracks with no geometry', async () => {
    const pb = fakePb(makeCollections({ keyframes: [] }));
    const result = await getTracksAt(pb, { mediaId: 'm1', at: 6.0 });
    expect(result.hits).toEqual([]);
    expect(result.withoutGeometry).toBe(1);
  });

  it('needs a scope', async () => {
    const pb = fakePb(makeCollections());
    await expect(getTracksAt(pb, { at: 1 })).rejects.toThrow(
      /-m <mediaId> or --track/
    );
  });
});

describe('estimateExportFrames', () => {
  const tracks = [
    makeTrack({ trackData: { frameCount: 800 }, duration: 100 }),
    makeTrack({ trackData: { frameCount: 80 }, duration: 10 }),
  ];

  it('sums the stored counts when nothing thins them', () => {
    expect(estimateExportFrames(tracks, { every: 0 })).toBe(880);
  });

  it('models --every from the span of each track', () => {
    // 100s and 10s at one frame per second, plus the retained final frame.
    expect(estimateExportFrames(tracks, { every: 1 })).toBe(102 + 12);
  });

  it('never estimates more frames than are stored', () => {
    const short = [makeTrack({ trackData: { frameCount: 4 }, duration: 100 })];
    expect(estimateExportFrames(short, { every: 1 })).toBe(4);
  });

  it('caps per track', () => {
    expect(
      estimateExportFrames(tracks, { every: 0, maxFramesPerTrack: 10 })
    ).toBe(20);
  });

  it('ignores tracks the provider gave no count for', () => {
    expect(
      estimateExportFrames([makeTrack({ trackData: {} })], { every: 0 })
    ).toBe(0);
  });
});

describe('prepareFrames', () => {
  const opts = (
    over: Partial<TrackExportOptions> = {}
  ): TrackExportOptions => ({
    ...TRACK_EXPORT_DEFAULTS,
    ...over,
  });

  it('thins with --every and keeps the final frame', () => {
    const out = prepareFrames(frames(80), { start: 0 }, opts({ every: 1 }));
    expect(out[0].t).toBe(0);
    expect(out[out.length - 1].t).toBe(9.875);
    expect(out.length).toBeLessThan(80);
  });

  it('caps per track after thinning', () => {
    const out = prepareFrames(
      frames(80),
      { start: 0 },
      opts({ every: 1, maxFramesPerTrack: 4 })
    );
    expect(out).toHaveLength(4);
  });

  it('rebases t under --relative, leaving absolute time by default', () => {
    const absolute = prepareFrames(frames(3, 5.75), { start: 5.75 }, opts());
    expect(absolute[0].t).toBe(5.75);
    const relative = prepareFrames(
      frames(3, 5.75),
      { start: 5.75 },
      opts({ relative: true })
    );
    expect(relative[0].t).toBe(0);
  });

  it('rounds geometry to --precision', () => {
    const raw = [
      {
        t: 1,
        bbox: {
          left: 0.5805000066757202,
          top: 0.4902999997138977,
          right: 0.6069999933242798,
          bottom: 0.5430999994277954,
        },
        confidence: 0.7105675935745239,
      },
    ];
    const out = prepareFrames(raw, { start: 0 }, opts({ precision: 4 }));
    expect(out[0].bbox).toEqual({
      left: 0.5805,
      top: 0.4903,
      right: 0.607,
      bottom: 0.5431,
    });
    expect(out[0].confidence).toBe(0.7106);
  });
});

describe('export rows', () => {
  const track = makeTrack();
  const frame = { width: 1920, height: 1080 };
  const kf = {
    t: 5.75,
    bbox: { left: 0.2755, top: 0.7209, right: 0.9897, bottom: 0.9823 },
    confidence: 0.722,
  };

  it('emits normalized fractions by default', () => {
    const row = exportRow(track, kf, { pixels: false }, frame);
    expect(row).toEqual({
      track: 'lt1',
      trackId: '4',
      media: 'm1',
      type: 'object',
      subject: 'tableware',
      entity: 'Erik',
      t: 5.75,
      left: 0.2755,
      top: 0.7209,
      right: 0.9897,
      bottom: 0.9823,
      confidence: 0.722,
    });
  });

  it('converts to whole pixels under --pixels', () => {
    const row = exportRow(track, kf, { pixels: true }, frame);
    expect(row).toMatchObject({
      left: 529,
      top: 779,
      right: 1900,
      bottom: 1061,
    });
  });

  it('drops a --pixels row rather than emitting a fake 0,0 box', () => {
    expect(
      exportRow(track, kf, { pixels: true }, { width: 0, height: 0 })
    ).toBeNull();
  });

  it('names the units in the CSV header', () => {
    expect(csvHeader({ pixels: false })).toContain(',left,top,right,bottom,');
    expect(csvHeader({ pixels: true })).toContain(
      ',left_px,top_px,right_px,bottom_px,'
    );
  });

  it('quotes only fields that would break the row', () => {
    const row = exportRow(
      makeTrack({ trackData: { entity: 'a,b "quoted"' } }),
      kf,
      { pixels: false },
      frame
    )!;
    expect(csvLine(row)).toContain('"a,b ""quoted"""');
    expect(csvLine(row).startsWith('lt1,4,m1,object,')).toBe(true);
  });

  it('leaves confidence empty when a frame has none', () => {
    const row = exportRow(
      track,
      { t: 1, bbox: kf.bbox },
      { pixels: false },
      frame
    )!;
    expect(row.confidence).toBe('');
    expect(csvLine(row).endsWith(',')).toBe(true);
  });
});

describe('fetchExportTracks', () => {
  it('pages the cheap read to the end without touching keyframes', async () => {
    const page1 = [makeTrack({ id: 'a' })];
    const page2 = [makeTrack({ id: 'b' })];
    const getList = vi.fn(
      async (page: number, _perPage: number, _options: { fields?: string }) =>
        listResult(page === 1 ? page1 : page2, {
          page,
          perPage: 1,
          totalItems: 2,
        })
    );
    const pb = fakePb({ LabelTrack: { getList, getOne: vi.fn() } });

    const tracks = await fetchExportTracks(pb, 'MediaRef = m1');
    expect(tracks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(getList).toHaveBeenCalledTimes(2);
    for (const [, , options] of getList.mock.calls) {
      expect(options.fields).not.toContain('keyframes');
    }
  });
});

describe('budgetExceededMessage', () => {
  it('names every way out and says nothing was fetched', () => {
    const message = budgetExceededMessage(1_200_000, {
      ...TRACK_EXPORT_DEFAULTS,
      maxFrames: DEFAULT_MAX_FRAMES,
    });
    expect(message).toContain('Nothing was fetched');
    expect(message).toContain('--every');
    expect(message).toContain('--max-frames-per-track');
    expect(message).toContain('--min-confidence');
    expect(message).toContain('--max-frames');
  });
});
