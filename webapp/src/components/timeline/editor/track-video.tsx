'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import pb from '@/lib/pocketbase-client';
import {
  clipSourceTimeAtOffset,
  findActiveClip,
  findNextClip,
  type File,
  type Media,
  type PlacedClip,
  type PlaybackTrack,
  type TimelineClip,
} from '@project/shared';

// Start preloading the standby buffer this many seconds before an upcoming cut.
const PRELOAD_LOOKAHEAD_SECONDS = 5;
// How long an unprepared cut may hold the outgoing clip's last frame before
// the channel goes hidden while the incoming clip is still loading.
const CUT_HOLD_MS = 250;
// Only reseek when the drift is significant, to avoid jitter.
const SEEK_TOLERANCE_SECONDS = 0.3;
// HTMLMediaElement.readyState thresholds
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;

// Proxy URL cache shared across track players (media id → URL, null if no proxy)
const proxyUrlCache = new Map<string, Promise<string | null>>();

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
  })().catch((err) => {
    console.error('Failed to load video source:', err);
    proxyUrlCache.delete(mediaId);
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
}

/** Mutable bookkeeping for one of the channel's two <video> elements. */
interface BufferState {
  /** Media whose proxy is loaded (or loading) into the element's src. */
  srcMediaId: string | null;
  /** Clip the buffer was last prepared for (prep idempotence guard). */
  preparedClipId: string | null;
  /** Seek to apply once the element has metadata. */
  pendingSeek: number | null;
}

interface ChannelState {
  frontIndex: 0 | 1;
  buffers: [BufferState, BufferState];
  /** Clip id the current outgoing-frame hold was started for (one per cut). */
  holdClipId: string | null;
  holding: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
}

function endHold(s: ChannelState) {
  if (s.holdTimer) {
    clearTimeout(s.holdTimer);
    s.holdTimer = null;
  }
  s.holdClipId = null;
  s.holding = false;
}

/**
 * Double-buffered video channel for a single track, synced to the shared
 * timeline clock. Two persistent <video> elements swap front/standby roles:
 * the visible front plays the clip at the playhead while the hidden standby
 * preloads the upcoming clip (pre-seeked, paused) — so a cut is a visibility
 * swap instead of a src change, with no black frame while the next file
 * connects. A cut that arrives unprepared (scrub landing, slow network)
 * holds the outgoing frame for up to CUT_HOLD_MS, then hides the channel
 * until the incoming clip can render.
 *
 * The elements are driven imperatively (src, visibility, currentTime,
 * play/pause) from a single reconcile pass — run pre-paint on every commit
 * and again from the standby's media events — so swaps never wait on a React
 * re-render; React only renders the static element pair.
 */
export function TrackVideo({
  track,
  zIndex,
  currentTime,
  isPlaying,
  muted,
}: TrackVideoProps) {
  const refA = useRef<HTMLVideoElement>(null);
  const refB = useRef<HTMLVideoElement>(null);
  const stateRef = useRef<ChannelState>({
    frontIndex: 0,
    buffers: [
      { srcMediaId: null, preparedClipId: null, pendingSeek: null },
      { srcMediaId: null, preparedClipId: null, pendingSeek: null },
    ],
    holdClipId: null,
    holding: false,
    holdTimer: null,
  });
  // Latest reconcile closure, for callbacks created in earlier renders
  // (the hold timer, async URL resolutions).
  const reconcileRef = useRef<() => void>(() => {});

  const active = findActiveClip(track.mediaClips, currentTime);
  const activeMediaId = active?.clip.MediaRef ?? null;
  const next = findNextClip(track.mediaClips, currentTime);

  const getEl = (index: 0 | 1) => (index === 0 ? refA : refB).current;

  const reconcile = () => {
    const s = stateRef.current;

    // --- Promote / hold: decide which buffer fronts the channel ---
    if (active && activeMediaId) {
      if (s.buffers[s.frontIndex].srcMediaId !== activeMediaId) {
        const backIndex = (1 - s.frontIndex) as 0 | 1;
        const backEl = getEl(backIndex);
        if (
          s.buffers[backIndex].srcMediaId === activeMediaId &&
          backEl &&
          backEl.readyState >= HAVE_CURRENT_DATA
        ) {
          // The standby has the cut buffered: swap roles.
          getEl(s.frontIndex)?.pause();
          s.frontIndex = backIndex;
          endHold(s);
        } else if (
          s.buffers[s.frontIndex].srcMediaId !== null &&
          s.holdClipId !== active.clip.id
        ) {
          // Unprepared cut: hold the outgoing frame briefly while the
          // standby loads (promotion fires from its media events). When the
          // timer lapses first, the channel goes hidden until it's ready.
          s.holdClipId = active.clip.id;
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

    // --- Standby prep: keep the hidden buffer loading what's needed next ---
    let target: PlacedClip | undefined;
    let seekTo = 0;
    if (active && activeMediaId && frontBuf.srcMediaId !== activeMediaId) {
      // The active clip isn't on screen (unprepared cut / scrub landing /
      // first load): recover through the standby.
      target = active;
      seekTo = clipSourceTimeAtOffset(
        active.clip,
        currentTime - active.globalStart
      );
    } else if (
      next?.clip.MediaRef &&
      next.clip.MediaRef !== frontBuf.srcMediaId
    ) {
      // Upcoming cut to different media: prep close to the boundary, or
      // immediately while idling in a gap. Same-media cuts stay on the
      // front element (the clock sync's seek handles them).
      if (
        !active ||
        next.globalStart - currentTime <= PRELOAD_LOOKAHEAD_SECONDS
      ) {
        target = next;
        seekTo = clipSourceTimeAtOffset(next.clip, 0);
      }
    } else if (!active && !next) {
      // Past the channel's last clip: warm its first clip so replaying the
      // timeline starts instantly.
      let first: PlacedClip | undefined;
      for (const p of track.mediaClips) {
        if (!first || p.globalStart < first.globalStart) first = p;
      }
      if (first?.clip.MediaRef && first.clip.MediaRef !== frontBuf.srcMediaId) {
        target = first;
        seekTo = clipSourceTimeAtOffset(first.clip, 0);
      }
    }

    const targetMediaId = target?.clip.MediaRef;
    if (
      target &&
      targetMediaId &&
      standbyBuf.preparedClipId !== target.clip.id
    ) {
      standbyBuf.preparedClipId = target.clip.id;
      standbyBuf.pendingSeek = seekTo;
      if (standbyBuf.srcMediaId === targetMediaId) {
        // Same file already loaded (e.g. A-B-A ping-pong): re-seek only.
        if (standbyEl && standbyEl.readyState >= HAVE_METADATA) {
          if (
            Math.abs(standbyEl.currentTime - seekTo) > SEEK_TOLERANCE_SECONDS
          ) {
            standbyEl.currentTime = seekTo;
          }
          standbyBuf.pendingSeek = null;
        }
      } else {
        const clip = target.clip as ClipWithProxyExpand;
        const targetClipId = target.clip.id;
        const frontIndexAtPrep = s.frontIndex;
        getProxyUrl(
          targetMediaId,
          clip.expand?.MediaRef,
          clip.expand?.MediaRef?.expand?.proxyFileRef
        ).then((url) => {
          const cur = stateRef.current;
          // Bail if roles flipped or the prep was retargeted while resolving
          if (cur.frontIndex !== frontIndexAtPrep) return;
          const buf = cur.buffers[standbyIndex];
          if (buf.preparedClipId !== targetClipId) return;
          if (!url) return; // no proxy: nothing to preload for this clip
          const el = getEl(standbyIndex);
          if (!el) return;
          buf.srcMediaId = targetMediaId;
          el.src = url;
        });
      }
    }

    // --- Visibility ---
    const frontMatches =
      !!active && !!activeMediaId && frontBuf.srcMediaId === activeMediaId;
    const visible = frontMatches || (!!active && s.holding);
    if (frontEl) frontEl.style.visibility = visible ? 'visible' : 'hidden';
    if (standbyEl) standbyEl.style.visibility = 'hidden';

    // --- Clock sync on the front element ---
    if (!frontEl) return;
    if (!frontMatches || !active) {
      if (!frontEl.paused) frontEl.pause();
      return;
    }
    // Composite clips play their edit list back-to-back: the timeline offset
    // maps through the segments — windowed by the clip's start/end trim — so
    // cut and trimmed content is skipped, matching the render.
    const localTime = clipSourceTimeAtOffset(
      active.clip,
      currentTime - active.globalStart
    );
    if (Math.abs(frontEl.currentTime - localTime) > SEEK_TOLERANCE_SECONDS) {
      frontEl.currentTime = localTime;
    }
    if (isPlaying && frontEl.paused) {
      frontEl.play().catch(() => {}); // Ignore play errors
    } else if (!isPlaying && !frontEl.paused) {
      frontEl.pause();
    }
  };

  // Apply the pre-seek as soon as the standby's metadata is in (seeking
  // before metadata is unreliable); preload="auto" then buffers around the
  // upcoming clip's first frame.
  const handleLoadedMetadata = (index: 0 | 1) => () => {
    const buf = stateRef.current.buffers[index];
    const el = getEl(index);
    if (el && buf.pendingSeek !== null) {
      el.currentTime = buf.pendingSeek;
      buf.pendingSeek = null;
    }
  };

  // Standby readiness re-runs reconcile so a cut that was still loading when
  // the playhead crossed it promotes the moment it can render a frame.
  const handleMediaReady = (index: 0 | 1) => () => {
    if (index === stateRef.current.frontIndex) return;
    reconcile();
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
    };
  }, []);

  return (
    <>
      {([0, 1] as const).map((i) => (
        <video
          key={i}
          ref={i === 0 ? refA : refB}
          onLoadedMetadata={handleLoadedMetadata(i)}
          onLoadedData={handleMediaReady(i)}
          onCanPlay={handleMediaReady(i)}
          onSeeked={handleMediaReady(i)}
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
