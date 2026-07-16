import { render, act, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { PlacedClip, PlaybackTrack, TimelineClip } from '@project/shared';
import { TrackVideo } from '../track-video';
import { PlaybackStallRegistry } from '../playback-stall-registry';

// happy-dom has no media pipeline: readyState never advances, media events
// never fire on their own, and no data loads. These tests drive the element
// lifecycle manually (readyState overrides + fireEvent); actual buffering and
// cut seamlessness are covered by manual QA.

vi.mock('@/lib/pocketbase-client', () => ({
  default: {
    files: {
      getURL: vi.fn(
        (rec: { id: string }, file: string) =>
          `http://pb.test/files/${rec.id}/${file}`
      ),
    },
    collection: vi.fn(() => ({
      getOne: vi.fn(() => {
        throw new Error(
          'unexpected PocketBase fetch — fixtures should resolve via expand'
        );
      }),
    })),
  },
}));

function makeMedia(mediaId: string, opts: { proxy?: boolean } = {}) {
  const hasProxy = opts.proxy ?? true;
  return {
    id: mediaId,
    proxyFileRef: hasProxy ? `file-${mediaId}` : undefined,
    expand: hasProxy
      ? { proxyFileRef: { id: `file-${mediaId}`, file: `${mediaId}.mp4` } }
      : {},
  };
}

function proxyUrl(mediaId: string) {
  return `http://pb.test/files/file-${mediaId}/${mediaId}.mp4`;
}

function makePlaced(
  id: string,
  mediaId: string,
  globalStart: number,
  globalEnd: number,
  opts: {
    start?: number;
    end?: number;
    segments?: Array<{ start: number; end: number }>;
    media?: ReturnType<typeof makeMedia>;
  } = {}
): PlacedClip {
  const start = opts.start ?? 0;
  const clip = {
    id,
    MediaRef: mediaId,
    start,
    end: opts.end ?? start + (globalEnd - globalStart),
    duration: globalEnd - globalStart,
    order: 0,
    meta: opts.segments ? { segments: opts.segments } : undefined,
    expand: { MediaRef: opts.media ?? makeMedia(mediaId) },
  } as unknown as TimelineClip;
  return { clip, globalStart, globalEnd };
}

function makeTrack(mediaClips: PlacedClip[]): PlaybackTrack {
  return {
    trackId: 'track-1',
    layer: 0,
    opacity: 1,
    volume: 1,
    isMuted: false,
    mediaClips,
    captionClips: [],
    timelineClips: [],
  };
}

function setReadyState(el: HTMLVideoElement, value: number) {
  Object.defineProperty(el, 'readyState', {
    configurable: true,
    get: () => value,
  });
}

function renderTrack(
  track: PlaybackTrack,
  currentTime: number,
  stallRegistry?: PlaybackStallRegistry
) {
  const props = {
    track,
    zIndex: 0,
    isPlaying: true,
    muted: true,
    stallRegistry,
  };
  const utils = render(<TrackVideo {...props} currentTime={currentTime} />);
  const setTime = async (time: number) => {
    utils.rerender(<TrackVideo {...props} currentTime={time} />);
    await act(async () => {});
  };
  const videos = () =>
    Array.from(utils.container.querySelectorAll('video')) as [
      HTMLVideoElement,
      HTMLVideoElement,
    ];
  return { ...utils, setTime, videos };
}

/**
 * Complete the initial-load handshake: the first prep targets the active
 * clip through the standby (element index 1, since the front role starts at
 * index 0), which promotes to front once it reports a renderable frame.
 */
async function establishFront(
  t: ReturnType<typeof renderTrack>
): Promise<{ front: HTMLVideoElement; standby: HTMLVideoElement }> {
  await act(async () => {});
  const [first, second] = t.videos();
  setReadyState(second, 4);
  fireEvent.loadedData(second);
  await act(async () => {});
  return { front: second, standby: first };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TrackVideo double-buffered prefetch', () => {
  it('loads the active clip through the standby and promotes it when ready', async () => {
    const track = makeTrack([makePlaced('c1', 'm1a', 0, 10)]);
    const t = renderTrack(track, 1);
    await act(async () => {});

    const [first, second] = t.videos();
    // Prep goes to the standby (index 1); nothing is visible yet.
    expect(second.src).toBe(proxyUrl('m1a'));
    expect(first.src).toBe('');
    expect(second.style.visibility).toBe('hidden');

    setReadyState(second, 4);
    fireEvent.loadedData(second);
    expect(second.style.visibility).toBe('visible');
    expect(first.style.visibility).toBe('hidden');
  });

  it('applies the pre-seek to the clip in-point on loadedmetadata', async () => {
    // Clip trimmed to source [4, 14): the first visible frame is source 4s
    const track = makeTrack([makePlaced('c1', 'm1b', 0, 10, { start: 4 })]);
    const t = renderTrack(track, 0);
    await act(async () => {});

    const [, standby] = t.videos();
    expect(standby.src).toBe(proxyUrl('m1b'));
    fireEvent.loadedMetadata(standby);
    expect(standby.currentTime).toBe(4);
  });

  it('preloads an upcoming different-media clip only within the lookahead window', async () => {
    const track = makeTrack([
      makePlaced('c1', 'm1c', 0, 20),
      makePlaced('c2', 'm2c', 20, 30),
    ]);
    const t = renderTrack(track, 1);
    const { standby } = await establishFront(t);

    // 19s from the cut: outside PRELOAD_LOOKAHEAD_SECONDS, no prep
    expect(standby.src).toBe('');

    await t.setTime(12);
    // 8s from the cut: standby loads the next clip's media
    expect(standby.src).toBe(proxyUrl('m2c'));
  });

  it('swaps visibility at a prepared cut without remounting elements', async () => {
    const track = makeTrack([
      makePlaced('c1', 'm1d', 0, 10),
      makePlaced('c2', 'm2d', 10, 20),
    ]);
    const t = renderTrack(track, 6);
    const { front, standby } = await establishFront(t);
    expect(standby.src).toBe(proxyUrl('m2d'));

    setReadyState(standby, 4);
    fireEvent.canPlay(standby);
    // Still mid-clip c1: ready, but no premature swap
    expect(front.style.visibility).toBe('visible');

    const pauseSpy = vi.spyOn(front, 'pause');
    await t.setTime(10.05);

    const [a, b] = t.videos();
    // Same DOM nodes, roles flipped: no unmount, no src change on a visible
    // element — the cut is a pure visibility swap.
    expect(a).toBe(standby);
    expect(b).toBe(front);
    expect(standby.style.visibility).toBe('visible');
    expect(front.style.visibility).toBe('hidden');
    expect(standby.src).toBe(proxyUrl('m2d'));
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('double-buffers a same-media cut: standby pre-seeks the far side and swaps', async () => {
    // c2 jumps to source 20s within the same media — a real discontinuity
    const track = makeTrack([
      makePlaced('c1', 'm1e', 0, 5),
      makePlaced('c2', 'm1e', 5, 10, { start: 20 }),
    ]);
    const t = renderTrack(track, 1);
    const { front, standby } = await establishFront(t);

    // Within lookahead: the standby loads the same file, pre-seeked to 20s
    expect(standby.src).toBe(proxyUrl('m1e'));
    fireEvent.loadedMetadata(standby);
    expect(standby.currentTime).toBe(20);

    setReadyState(standby, 4);
    fireEvent.canPlay(standby);
    await t.setTime(5.2);
    // The cut is a buffer swap, not a live seek on the playing element
    expect(standby.style.visibility).toBe('visible');
    expect(front.style.visibility).toBe('hidden');
  });

  it('plays straight through same-media clips that are contiguous in source time', async () => {
    // c2 resumes exactly where c1's source window ends: no seek needed
    const track = makeTrack([
      makePlaced('c1', 'm1k', 0, 5),
      makePlaced('c2', 'm1k', 5, 10, { start: 5 }),
    ]);
    const t = renderTrack(track, 1);
    const { front, standby } = await establishFront(t);

    // Continuous boundary: nothing to prep
    expect(standby.src).toBe('');

    // Crossing it keeps the same front element, no swap, no hold
    front.currentTime = 5.2;
    await t.setTime(5.2);
    expect(front.style.visibility).toBe('visible');
    expect(standby.src).toBe('');
  });

  it('double-buffers an edit-list jump inside a composite clip', async () => {
    // One clip, segments [0-5] + [20-25]: the 5s mark is a same-media cut
    const track = makeTrack([
      makePlaced('c1', 'm1l', 0, 10, {
        end: 25,
        segments: [
          { start: 0, end: 5 },
          { start: 20, end: 25 },
        ],
      }),
    ]);
    const t = renderTrack(track, 1);
    const { front, standby } = await establishFront(t);

    // The upcoming jump preps through the standby, pre-seeked past the gap
    expect(standby.src).toBe(proxyUrl('m1l'));
    fireEvent.loadedMetadata(standby);
    expect(standby.currentTime).toBe(20);

    setReadyState(standby, 4);
    fireEvent.canPlay(standby);
    await t.setTime(5.3);
    expect(standby.style.visibility).toBe('visible');
    expect(front.style.visibility).toBe('hidden');
  });

  it('preps the next clip immediately while idling in a gap', async () => {
    const track = makeTrack([
      makePlaced('c1', 'm1f', 0, 3),
      makePlaced('c2', 'm2f', 20, 24),
    ]);
    const t = renderTrack(track, 1);
    const { front, standby } = await establishFront(t);
    // 19s out: beyond the lookahead while a clip is active
    expect(standby.src).toBe('');

    await t.setTime(4);
    // In the gap: the channel hides and the standby preps right away
    expect(front.style.visibility).toBe('hidden');
    expect(standby.src).toBe(proxyUrl('m2f'));
  });

  it('holds the outgoing frame briefly at an unprepared cut, then hides until ready', async () => {
    vi.useFakeTimers();
    const track = makeTrack([
      makePlaced('c1', 'm1g', 0, 5),
      makePlaced('c2', 'm2g', 5, 10),
    ]);
    const t = renderTrack(track, 1);
    const { front, standby } = await establishFront(t);
    // Standby prepped (src set) but never reaches HAVE_CURRENT_DATA
    expect(standby.src).toBe(proxyUrl('m2g'));

    await t.setTime(5.5);
    // Unready cut: the outgoing frame holds instead of flashing black
    expect(front.style.visibility).toBe('visible');
    expect(front.paused).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    // Hold window lapsed: channel hides until the incoming clip can render
    expect(front.style.visibility).toBe('hidden');
    expect(standby.style.visibility).toBe('hidden');

    setReadyState(standby, 4);
    fireEvent.canPlay(standby);
    expect(standby.style.visibility).toBe('visible');
  });

  it('ignores a stale prep resolution after a scrub retargets the standby', async () => {
    // m-slow resolves through a deferred Media fetch (no expand data)
    let resolveSlowMedia: (value: unknown) => void = () => {};
    const slowMedia = new Promise((resolve) => {
      resolveSlowMedia = resolve;
    });
    const pbMock = (await import('@/lib/pocketbase-client'))
      .default as unknown as {
      collection: ReturnType<typeof vi.fn>;
    };
    pbMock.collection.mockImplementation((name: string) => ({
      getOne: vi.fn((id: string) => {
        if (name === 'Media' && id === 'm-slow') return slowMedia;
        if (name === 'Files' && id === 'file-m-slow') {
          return Promise.resolve({ id: 'file-m-slow', file: 'm-slow.mp4' });
        }
        throw new Error(`unexpected fetch ${name}/${id}`);
      }),
    }));

    const track = makeTrack([
      makePlaced('c1', 'm1h', 0, 10),
      makePlaced('c2', 'm-slow', 10, 20, {
        media: undefined as unknown as ReturnType<typeof makeMedia>,
      }),
      makePlaced('c3', 'm3h', 20, 30),
    ]);
    // Strip the expand so m-slow resolves through the deferred fetch
    (track.mediaClips[1].clip as { expand?: unknown }).expand = undefined;

    const t = renderTrack(track, 6);
    const { standby } = await establishFront(t);
    // Prep for m-slow is in flight (deferred), no src yet
    expect(standby.src).toBe('');

    // Scrub into c3: the recovery prep retargets the standby to m3h
    await t.setTime(21);
    expect(standby.src).toBe(proxyUrl('m3h'));

    // The stale m-slow resolution must not clobber the retargeted standby
    resolveSlowMedia({ id: 'm-slow', proxyFileRef: 'file-m-slow' });
    await act(async () => {});
    expect(standby.src).toBe(proxyUrl('m3h'));
  });

  it('warms the first clip for replay once the playhead passes the last clip', async () => {
    const track = makeTrack([
      makePlaced('c1', 'm1i', 0, 3),
      makePlaced('c2', 'm2i', 3, 6),
    ]);
    // Start inside the second clip so the front holds m2i
    const t = renderTrack(track, 4);
    const { standby } = await establishFront(t);

    await t.setTime(7);
    expect(standby.src).toBe(proxyUrl('m1i'));
  });

  it('never shows anything for media without a proxy', async () => {
    const track = makeTrack([
      makePlaced('c1', 'm-noproxy', 0, 5, {
        media: makeMedia('m-noproxy', { proxy: false }),
      }),
    ]);
    const t = renderTrack(track, 1);
    await act(async () => {});

    const [first, second] = t.videos();
    expect(first.src).toBe('');
    expect(second.src).toBe('');
    expect(first.style.visibility).toBe('hidden');
    expect(second.style.visibility).toBe('hidden');
  });

  it('reports a stall at an unprepared cut and clears it once the cut renders', async () => {
    const registry = new PlaybackStallRegistry();
    const track = makeTrack([
      makePlaced('c1', 'm1m', 0, 5),
      makePlaced('c2', 'm2m', 5, 10),
    ]);
    const t = renderTrack(track, 1, registry);
    const { standby } = await establishFront(t);
    expect(registry.anyStalled()).toBe(false);

    // Standby prepped (src set) but not yet renderable at the cut: the
    // channel reports itself stalled so the player freezes the clock.
    await t.setTime(5.5);
    expect(registry.anyStalled()).toBe(true);

    setReadyState(standby, 4);
    fireEvent.canPlay(standby);
    expect(registry.anyStalled()).toBe(false);
  });

  it('never stalls the clock on media without a proxy', async () => {
    const registry = new PlaybackStallRegistry();
    const track = makeTrack([
      makePlaced('c1', 'm-noproxy-stall', 0, 5, {
        media: makeMedia('m-noproxy-stall', { proxy: false }),
      }),
    ]);
    renderTrack(track, 1, registry);
    await act(async () => {});
    expect(registry.anyStalled()).toBe(false);
  });

  it('stops stalling when the incoming media errors instead of loading', async () => {
    const registry = new PlaybackStallRegistry();
    const track = makeTrack([
      makePlaced('c1', 'm1o', 0, 5),
      makePlaced('c2', 'm2o', 5, 10),
    ]);
    const t = renderTrack(track, 1, registry);
    const { standby } = await establishFront(t);
    expect(standby.src).toBe(proxyUrl('m2o'));

    await t.setTime(5.5);
    expect(registry.anyStalled()).toBe(true);

    // A broken proxy must hide the channel, not freeze the clock forever
    fireEvent.error(standby);
    expect(registry.anyStalled()).toBe(false);
  });

  it('pauses its element while any other channel is stalled, resumes after', async () => {
    const registry = new PlaybackStallRegistry();
    const track = makeTrack([makePlaced('c1', 'm1n', 0, 10)]);
    const t = renderTrack(track, 1, registry);
    const { front } = await establishFront(t);
    expect(front.paused).toBe(false);

    // Another track can't render: the shared clock freezes, so this channel
    // must not run ahead (it would get seek-corrected backwards forever).
    registry.set('other-track', true);
    await t.setTime(1.1);
    expect(front.paused).toBe(true);

    registry.set('other-track', false);
    await t.setTime(1.2);
    expect(front.paused).toBe(false);
  });

  it('applies track volume to both buffers', async () => {
    const track = makeTrack([makePlaced('c1', 'm1j', 0, 5)]);
    track.volume = 0.4;
    const t = renderTrack(track, 1);
    await act(async () => {});

    const [first, second] = t.videos();
    expect(first.volume).toBe(0.4);
    expect(second.volume).toBe(0.4);
  });
});
