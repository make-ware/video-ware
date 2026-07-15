'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import pb from '@/lib/pocketbase-client';
import {
  clipPlaybackRegions,
  findActiveClip,
  findNextPlaybackCut,
  playbackRegionAt,
  regionSourceEnd,
  PLAYBACK_CONTINUITY_EPSILON,
  type File,
  type Media,
  type PlacedClip,
  type PlaybackRegion,
  type PlaybackTrack,
  type TimelineClip,
} from '@project/shared';
import type { PlaybackStallRegistry } from './playback-stall-registry';

// Start preloading the standby buffer this many seconds before an upcoming
// cut. Proxies can be multi-gigabyte files whose first fetch has to pull the
// index and then buffer around an arbitrary seek point, so give the standby
// a generous head start — it sits idle otherwise.
const PRELOAD_LOOKAHEAD_SECONDS = 10;
// How long an unprepared cut may hold the outgoing clip's last frame before
// the channel goes hidden while the incoming clip is still loading. (With
// the stalled clock frozen at the cut, the held frame reads as "paused";
// after this window the channel hides and the player's spinner takes over.)
const CUT_HOLD_MS = 500;
// Only reseek when the drift is significant, to avoid jitter.
const SEEK_TOLERANCE_SECONDS = 0.3;
// HTMLMediaElement.readyState thresholds
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;

// Proxy URL cache shared across track players (media id → URL, null if no proxy)
const proxyUrlCache = new Map<string, Promise<string | null>>();
// Media whose proxy resolved to nothing playable. These channels stay hidden
// and must never stall the shared clock waiting for a load that won't come.
const unplayableMediaIds = new Set<string>();

function getProxyUrl(
  mediaId: string,
  expandedMedia?: Media,
  expandedProxyFile?: File
): Promise<string | null> {
  const cached = proxyUrlCache.get(mediaId);
  if (cached) return cached;

  const promise = (async () => {
    // Timeline clips arrive with MediaRef.proxyFileRef expanded, so the URL
    // usually resolves without any extra round-trips.
    if (expandedProxyFile?.file) {
      return pb.files.getURL(expandedProxyFile, expandedProxyFile.file);
    }
    const media =
      expandedMedia ??
      ((await pb.collection('Media').getOne(mediaId)) as unknown as Media);
    if (!media.proxyFileRef) return null;
    const fileRef = await pb.collection('Files').getOne(media.proxyFileRef);
    return pb.files.getURL(fileRef, (fileRef as { file: string }).file);
  })()
    .then((url) => {
      if (url) unplayableMediaIds.delete(mediaId);
      else unplayableMediaIds.add(mediaId);
      return url;
    })
    .catch((err) => {
      console.error('Failed to load video source:', err);
      proxyUrlCache.delete(mediaId);
      unplayableMediaIds.add(mediaId);
      return null;
    });

  proxyUrlCache.set(mediaId, promise);
  return promise;
}

type ClipWithProxyExpand = TimelineClip & {
  expand?: { MediaRef?: Media & { expand?: { proxyFileRef?: File } } };
};

interface TrackVideoProps {
  track: PlaybackTrack;
  zIndex: number;
  currentTime: number;
  isPlaying: boolean;
  muted: boolean;
  /**
   * Shared stall state: this channel reports whether it can render the frame
   * at the playhead, and pauses its element while any channel is stalled
   * (the player freezes the shared clock off the same registry).
   */
  stallRegistry?: PlaybackStallRegistry;
}

/** Mutable bookkeeping for one of the channel's two <video> elements. */
interface BufferState {
  /** Media whose proxy is loaded (or loading) into the element's src. */
  srcMediaId: string | null;
  /** Continuous playback region the buffer is loaded/positioned for. */
  regionKey: string | null;
  /** Seek to apply once the element has metadata. */
  pendingSeek: number | null;
}

interface ChannelState {
  frontIndex: 0 | 1;
  buffers: [BufferState, BufferState];
  /** Region key the current outgoing-frame hold was started for (one per cut). */
  holdKey: string | null;
  holding: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
}

function endHold(s: ChannelState) {
  if (s.holdTimer) {
    clearTimeout(s.holdTimer);
    s.holdTimer = null;
  }
  s.holdKey = null;
  s.holding = false;
}

/** What the standby buffer should be loading, and where to pre-seek it. */
interface PrepTarget {
  region: PlaybackRegion;
  mediaId: string;
  clip: TimelineClip;
  seekTo: number;
}

/**
 * Double-buffered video channel for a single track, synced to the shared
 * timeline clock. Two persistent <video> elements swap front/standby roles:
 * the visible front plays the continuous region at the playhead while the
 * hidden standby preloads the far side of the next cut (pre-seeked, paused)
 * — so a cut is a visibility swap instead of a live seek, with no black
 * frame while the next position buffers.
 *
 * Every source-time discontinuity is a cut: a different-media clip boundary,
 * a same-media clip boundary, and an edit-list jump inside a composite clip
 * all preload through the standby — critical for multi-gigabyte proxies
 * where a raw seek on the playing element takes seconds. Same-media cuts
 * reuse the already-loaded standby (re-seek only), so jump-cut ping-pong
 * within one file alternates the two buffers. Boundaries where source time
 * flows continuously (adjacent split clips, gaps that pause the source) are
 * adopted by the front element without a swap.
 *
 * A cut that arrives unprepared (scrub landing, slow network) holds the
 * outgoing frame for up to CUT_HOLD_MS, then hides the channel until the
 * incoming region can render. Whenever the channel cannot render the
 * playhead's frame — unprepared cut, mid-region rebuffer, in-flight seek —
 * it reports itself stalled via the registry; the player freezes the shared
 * clock and every channel pauses, so playback waits for buffers instead of
 * falling further behind.
 *
 * The elements are driven imperatively (src, visibility, currentTime,
 * play/pause) from a single reconcile pass — run pre-paint on every commit
 * and again from media events — so swaps never wait on a React re-render;
 * React only renders the static element pair.
 */
export function TrackVideo({
  track,
  zIndex,
  currentTime,
  isPlaying,
  muted,
  stallRegistry,
}: TrackVideoProps) {
  const refA = useRef<HTMLVideoElement>(null);
  const refB = useRef<HTMLVideoElement>(null);
  const stateRef = useRef<ChannelState>({
    frontIndex: 0,
    buffers: [
      { srcMediaId: null, regionKey: null, pendingSeek: null },
      { srcMediaId: null, regionKey: null, pendingSeek: null },
    ],
    holdKey: null,
    holding: false,
    holdTimer: null,
  });
  // Latest reconcile closure, for callbacks created in earlier renders
  // (the hold timer, async URL resolutions, media events).
  const reconcileRef = useRef<() => void>(() => {});

  const channelKey = track.trackId ?? `layer-${track.layer}`;
  const active = findActiveClip(track.mediaClips, currentTime);
  const activeMediaId = active?.clip.MediaRef ?? null;

  const getEl = (index: 0 | 1) => (index === 0 ? refA : refB).current;

  const reconcile = () => {
    const s = stateRef.current;

    // Apply deferred pre-seeks the moment metadata allows them.
    for (const index of [0, 1] as const) {
      const buf = s.buffers[index];
      const el = getEl(index);
      if (buf.pendingSeek !== null && el && el.readyState >= HAVE_METADATA) {
        el.currentTime = buf.pendingSeek;
        buf.pendingSeek = null;
      }
    }

    // --- Expected playback position ---
    const region =
      active && activeMediaId
        ? playbackRegionAt(active, currentTime)
        : undefined;
    const expectedSourceTime = region
      ? region.sourceStart + Math.max(0, currentTime - region.timelineStart)
      : 0;

    const matches = (index: 0 | 1) =>
      !!region &&
      s.buffers[index].srcMediaId === activeMediaId &&
      s.buffers[index].regionKey === region.key;

    // --- Adopt: continuous same-media transitions don't need a swap ---
    // If the region the front was fronting ends exactly where the current
    // one begins (in both timeline and source time — adjacent split clips,
    // a gap that paused the source), the front element is already at the
    // right position: it adopts the new region and plays straight through.
    if (region && activeMediaId && !matches(s.frontIndex)) {
      const frontBuf = s.buffers[s.frontIndex];
      if (frontBuf.srcMediaId === activeMediaId && frontBuf.regionKey) {
        let prev: PlaybackRegion | undefined;
        for (const placed of track.mediaClips) {
          if (placed.clip.MediaRef !== activeMediaId) continue;
          prev = clipPlaybackRegions(placed).find(
            (r) => r.key === frontBuf.regionKey
          );
          if (prev) break;
        }
        if (
          prev &&
          prev.timelineEnd <=
            region.timelineStart + PLAYBACK_CONTINUITY_EPSILON &&
          Math.abs(regionSourceEnd(prev) - region.sourceStart) <=
            PLAYBACK_CONTINUITY_EPSILON
        ) {
          frontBuf.regionKey = region.key;
        }
      }
    }

    // --- Promote / hold: decide which buffer fronts the channel ---
    if (region) {
      if (!matches(s.frontIndex)) {
        const backIndex = (1 - s.frontIndex) as 0 | 1;
        const backEl = getEl(backIndex);
        if (
          matches(backIndex) &&
          s.buffers[backIndex].pendingSeek === null &&
          backEl &&
          backEl.readyState >= HAVE_CURRENT_DATA &&
          !backEl.seeking
        ) {
          // The standby has the cut buffered: swap roles.
          getEl(s.frontIndex)?.pause();
          s.frontIndex = backIndex;
          endHold(s);
        } else if (
          s.buffers[s.frontIndex].srcMediaId !== null &&
          s.holdKey !== region.key
        ) {
          // Unprepared cut: hold the outgoing frame briefly while the
          // standby loads (promotion fires from its media events). When the
          // timer lapses first, the channel goes hidden until it's ready.
          s.holdKey = region.key;
          s.holding = true;
          if (s.holdTimer) clearTimeout(s.holdTimer);
          s.holdTimer = setTimeout(() => {
            stateRef.current.holding = false;
            stateRef.current.holdTimer = null;
            reconcileRef.current();
          }, CUT_HOLD_MS);
        }
      } else {
        endHold(s);
      }
    } else {
      endHold(s);
    }

    // Roles may have just swapped: resolve them fresh.
    const frontEl = getEl(s.frontIndex);
    const frontBuf = s.buffers[s.frontIndex];
    const standbyIndex = (1 - s.frontIndex) as 0 | 1;
    const standbyEl = getEl(standbyIndex);
    const standbyBuf = s.buffers[standbyIndex];
    const frontMatches = matches(s.frontIndex);

    // --- Standby prep: keep the hidden buffer loading what's needed next ---
    let target: PrepTarget | undefined;
    if (active && activeMediaId && region && !frontMatches) {
      // The active region isn't on screen (unprepared cut / scrub landing /
      // first load): recover through the standby at the playhead position.
      target = {
        region,
        mediaId: activeMediaId,
        clip: active.clip,
        seekTo: expectedSourceTime,
      };
    } else {
      const cut = findNextPlaybackCut(track.mediaClips, currentTime);
      if (cut) {
        // Upcoming cut: prep close to the boundary, or immediately while
        // idling in a gap. Cuts whose incoming region continues the front's
        // current region in source time need no prep — the front adopts
        // them at the boundary.
        const continuous =
          frontMatches &&
          region &&
          cut.mediaId === frontBuf.srcMediaId &&
          region.timelineEnd <= cut.time + PLAYBACK_CONTINUITY_EPSILON &&
          Math.abs(regionSourceEnd(region) - cut.region.sourceStart) <=
            PLAYBACK_CONTINUITY_EPSILON;
        if (
          !continuous &&
          (!active || cut.time - currentTime <= PRELOAD_LOOKAHEAD_SECONDS)
        ) {
          target = {
            region: cut.region,
            mediaId: cut.mediaId,
            clip: cut.clip,
            seekTo: cut.region.sourceStart,
          };
        }
      } else if (!active) {
        // Past the channel's last clip: warm its first clip so replaying the
        // timeline starts instantly.
        let first: PlacedClip | undefined;
        for (const p of track.mediaClips) {
          if (!first || p.globalStart < first.globalStart) first = p;
        }
        if (
          first?.clip.MediaRef &&
          first.clip.MediaRef !== frontBuf.srcMediaId
        ) {
          const firstRegion = clipPlaybackRegions(first)[0];
          target = {
            region: firstRegion,
            mediaId: first.clip.MediaRef,
            clip: first.clip,
            seekTo: firstRegion.sourceStart,
          };
        }
      }
    }

    if (target && standbyBuf.regionKey !== target.region.key) {
      standbyBuf.regionKey = target.region.key;
      standbyBuf.pendingSeek = target.seekTo;
      if (standbyBuf.srcMediaId === target.mediaId) {
        // Same file already loaded (jump cuts within one media, A-B-A
        // ping-pong): re-seek only.
        if (standbyEl && standbyEl.readyState >= HAVE_METADATA) {
          if (
            Math.abs(standbyEl.currentTime - target.seekTo) >
            PLAYBACK_CONTINUITY_EPSILON
          ) {
            standbyEl.currentTime = target.seekTo;
          }
          standbyBuf.pendingSeek = null;
        }
      } else {
        const clip = target.clip as ClipWithProxyExpand;
        const targetKey = target.region.key;
        const targetMediaId = target.mediaId;
        getProxyUrl(
          targetMediaId,
          clip.expand?.MediaRef,
          clip.expand?.MediaRef?.expand?.proxyFileRef
        ).then((url) => {
          const cur = stateRef.current;
          // Bail if the buffer was promoted or retargeted while resolving
          if (cur.frontIndex === standbyIndex) return;
          const buf = cur.buffers[standbyIndex];
          if (buf.regionKey !== targetKey) return;
          if (!url) {
            // No proxy: nothing to load; re-run so the stall state clears.
            reconcileRef.current();
            return;
          }
          const el = getEl(standbyIndex);
          if (!el) return;
          buf.srcMediaId = targetMediaId;
          el.src = url;
        });
      }
    }

    // --- Visibility ---
    const visible = frontMatches || (!!region && s.holding);
    if (frontEl) frontEl.style.visibility = visible ? 'visible' : 'hidden';
    if (standbyEl) standbyEl.style.visibility = 'hidden';

    // --- Stall report: can this channel render the playhead's frame? ---
    const stalled =
      !!active &&
      !!activeMediaId &&
      !unplayableMediaIds.has(activeMediaId) &&
      (!frontMatches ||
        !frontEl ||
        frontEl.seeking ||
        frontEl.readyState <
          (isPlaying ? HAVE_FUTURE_DATA : HAVE_CURRENT_DATA));
    stallRegistry?.set(channelKey, stalled);

    // --- Clock sync on the front element ---
    if (!frontEl) return;
    if (!frontMatches || !region) {
      if (!frontEl.paused) frontEl.pause();
      return;
    }
    if (
      Math.abs(frontEl.currentTime - expectedSourceTime) >
      SEEK_TOLERANCE_SECONDS
    ) {
      frontEl.currentTime = expectedSourceTime;
    }
    // While any channel is stalled the shared clock is frozen: pause here
    // too so this element doesn't run ahead and get seek-corrected back.
    const shouldPlay =
      isPlaying && !(stallRegistry ? stallRegistry.anyStalled() : stalled);
    if (shouldPlay && frontEl.paused) {
      frontEl.play().catch(() => {}); // Ignore play errors
    } else if (!shouldPlay && !frontEl.paused) {
      frontEl.pause();
    }
  };

  // Apply the pre-seek as soon as the standby's metadata is in (seeking
  // before metadata is unreliable); preload="auto" then buffers around the
  // upcoming region's first frame.
  const handleLoadedMetadata = (index: 0 | 1) => () => {
    const buf = stateRef.current.buffers[index];
    const el = getEl(index);
    if (el && buf.pendingSeek !== null) {
      el.currentTime = buf.pendingSeek;
      buf.pendingSeek = null;
    }
    reconcileRef.current();
  };

  // Media readiness re-runs reconcile: standby events promote a cut the
  // moment it can render, and front events (waiting/canplay/seeked) keep the
  // stall report — and with it the shared clock — current.
  const handleMediaEvent = () => reconcileRef.current();

  // A proxy that errors (missing file, decode failure) will never become
  // renderable: mark it unplayable so its clips hide instead of stalling the
  // shared clock forever waiting on it.
  const handleError = (index: 0 | 1) => () => {
    const buf = stateRef.current.buffers[index];
    if (buf.srcMediaId) {
      console.error(`Video proxy failed to play for media ${buf.srcMediaId}`);
      unplayableMediaIds.add(buf.srcMediaId);
    }
    reconcileRef.current();
  };

  // Reconcile on every commit: the playhead advances via re-renders, and the
  // pre-paint pass makes prepared cut swaps invisible.
  useLayoutEffect(() => {
    reconcileRef.current = reconcile;
    reconcile();
  });

  // Apply track volume to both buffers
  useEffect(() => {
    for (const ref of [refA, refB]) {
      if (ref.current) ref.current.volume = track.volume;
    }
  }, [track.volume]);

  useEffect(() => {
    const s = stateRef.current;
    return () => {
      if (s.holdTimer) clearTimeout(s.holdTimer);
      stallRegistry?.delete(channelKey);
    };
  }, [stallRegistry, channelKey]);

  return (
    <>
      {([0, 1] as const).map((i) => (
        <video
          key={i}
          ref={i === 0 ? refA : refB}
          onLoadedMetadata={handleLoadedMetadata(i)}
          onLoadedData={handleMediaEvent}
          onCanPlay={handleMediaEvent}
          onCanPlayThrough={handleMediaEvent}
          onPlaying={handleMediaEvent}
          onWaiting={handleMediaEvent}
          onStalled={handleMediaEvent}
          onSeeked={handleMediaEvent}
          onError={handleError(i)}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ zIndex, opacity: track.opacity }}
          muted={muted || track.isMuted}
          playsInline
          preload="auto"
        />
      ))}
    </>
  );
}
