import type { TimelineClip, TimelineTrackRecord } from '@project/shared';
import { getClipRanges, getSortedTrackClips } from './clip-placement';

/**
 * A clip resolved to its absolute position on the global timeline.
 * globalStart/globalEnd are timeline seconds; clip.start/clip.end remain
 * source-media seconds (the trim window).
 */
export interface PlacedClip {
  clip: TimelineClip;
  globalStart: number;
  globalEnd: number;
}

/**
 * A track resolved for playback: its settings plus the placed clips it owns,
 * split into media clips (played via a <video> element) and caption clips
 * (rendered as overlays).
 */
export interface PlaybackTrack {
  trackId: string | null;
  layer: number;
  opacity: number;
  volume: number;
  isMuted: boolean;
  mediaClips: PlacedClip[];
  captionClips: PlacedClip[];
}

/**
 * Resolve timeline clips into per-track placed clips for the preview player.
 *
 * Placement matches the editor lanes and the render path: clips with a
 * timelineStart sit at that absolute time; clips without one are appended
 * sequentially after the preceding clips on the same track. Clips with no
 * TimelineTrackRef fall back to the layer-0 (or first) track, mirroring the
 * default-track assignment used when adding clips.
 *
 * Tracks are returned sorted by layer ascending (0 = bottom).
 */
export function buildPlaybackTracks(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[]
): PlaybackTrack[] {
  const defaultTrack = tracks.find((t) => t.layer === 0) ?? tracks[0];

  const clipsByTrack = new Map<string | null, TimelineClip[]>();
  for (const clip of clips) {
    const trackId = clip.TimelineTrackRef ?? defaultTrack?.id ?? null;
    const trackClips = clipsByTrack.get(trackId) ?? [];
    trackClips.push(clip);
    clipsByTrack.set(trackId, trackClips);
  }

  const playbackTracks: PlaybackTrack[] = [];

  const buildTrack = (
    trackId: string | null,
    track: TimelineTrackRecord | undefined,
    trackClips: TimelineClip[]
  ): PlaybackTrack => {
    // getClipRanges operates on the sorted clip list; keep indexes aligned
    const sorted = getSortedTrackClips(trackClips);
    const ranges = getClipRanges(trackClips);

    const placed: PlacedClip[] = sorted.map((clip, i) => ({
      clip,
      globalStart: ranges[i].start,
      globalEnd: ranges[i].end,
    }));

    return {
      trackId,
      layer: track?.layer ?? 0,
      opacity: track?.opacity ?? 1,
      volume: track?.volume ?? 1,
      isMuted: track?.isMuted ?? false,
      mediaClips: placed.filter((p) => p.clip.MediaRef),
      captionClips: placed.filter((p) => p.clip.CaptionRef),
    };
  };

  for (const track of tracks) {
    playbackTracks.push(
      buildTrack(
        track.id ?? null,
        track,
        clipsByTrack.get(track.id ?? null) ?? []
      )
    );
  }

  // Legacy timelines with clips but no track records: synthesize a layer-0 track
  const orphanClips = clipsByTrack.get(null);
  if (orphanClips && orphanClips.length > 0) {
    playbackTracks.push(buildTrack(null, undefined, orphanClips));
  }

  return playbackTracks.sort((a, b) => a.layer - b.layer);
}

/**
 * Find the clip active at a given timeline time, if any.
 */
export function findActiveClip(
  placed: PlacedClip[],
  time: number
): PlacedClip | undefined {
  return placed.find((p) => time >= p.globalStart && time < p.globalEnd);
}

/**
 * Total timeline duration: the furthest end of any placed clip across all
 * tracks. (Summing clip durations is wrong once clips overlap across tracks
 * or use explicit timelineStart positions.)
 */
export function computeTimelineDuration(
  clips: TimelineClip[],
  tracks: TimelineTrackRecord[]
): number {
  let max = 0;
  for (const track of buildPlaybackTracks(clips, tracks)) {
    for (const placed of [...track.mediaClips, ...track.captionClips]) {
      max = Math.max(max, placed.globalEnd);
    }
  }
  return max;
}
