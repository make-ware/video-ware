'use client';

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import {
  AlertTriangle,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Captions,
  CaptionsOff,
  Loader2,
} from 'lucide-react';
import { formatTimecode } from '@/utils/format-clip-time';
import { Button } from '@/components/ui/button';
import {
  MAX_PLAYBACK_CHANNELS,
  TimelineOrientation,
  buildPlaybackChannels,
  findActiveClip,
  type Caption,
  type CaptionCue,
  type CaptionStyle,
  type TimelineClip,
} from '@project/shared';
import { CaptionOverlay } from '@/components/captions';
import { TranscriptOverlay } from '@/components/transcripts/transcript-overlay';
import { TrackVideo } from './track-video';
import { PlaybackStallRegistry } from './playback-stall-registry';

export function TimelinePlayer() {
  const {
    timeline,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    duration,
    showSubtitles,
    setShowSubtitles,
    transcriptsByMedia,
  } = useTimeline();

  const [isMuted, setIsMuted] = useState(false);
  const lastUpdateRef = useRef<number>(0);

  // Channels report whether they can render the playhead's frame; the
  // playback loop freezes the clock while any can't, so playback waits for
  // buffers (huge proxies, slow cuts) instead of running ahead of the video.
  const [stallRegistry] = useState(() => new PlaybackStallRegistry());
  const isBuffering = useSyncExternalStore(
    stallRegistry.subscribe,
    stallRegistry.getSnapshot,
    () => false
  );

  // Resolve clips (including nested-timeline clips, expanded into extra
  // channels) to the bounded set of media player channels the preview drives
  // (layer ascending — index 0 is the bottom layer). Best effort: channels
  // beyond the budget are dropped and surfaced as a warning.
  const playback = useMemo(() => {
    if (!timeline) return null;
    return buildPlaybackChannels({
      clips: timeline.clips,
      tracks: timeline.tracks || [],
      nestedTimelines: timeline.nestedTimelines,
      rootTimelineId: timeline.id,
    });
  }, [timeline]);

  const videoTracks = useMemo(() => playback?.channels ?? [], [playback]);
  const droppedChannelCount = playback?.droppedChannelCount ?? 0;

  // Caption clips active at the playhead, across all tracks including nested
  // timelines (bottom layer first so higher layers render on top)
  const activeCaptions = useMemo(() => {
    const active: Array<{
      clipId: string;
      caption: Caption;
      localTime: number;
    }> = [];
    for (const placed of playback?.captionClips ?? []) {
      if (currentTime < placed.globalStart || currentTime >= placed.globalEnd) {
        continue;
      }
      const caption = (
        placed.clip as TimelineClip & { expand?: { CaptionRef?: Caption } }
      ).expand?.CaptionRef;
      if (!caption) continue;
      // Map timeline time into the caption's own (possibly trimmed) timeline
      active.push({
        clipId: placed.clip.id,
        caption,
        localTime: currentTime - placed.globalStart + placed.clip.start,
      });
    }
    return active;
  }, [playback, currentTime]);

  // Auto subtitles active at the playhead: for each non-muted channel, the
  // transcript of the clip playing there, at that clip's source time. Mirrors
  // the render (buildTranscriptCaptionSegment) so preview matches the output —
  // muted channels contribute nothing, exactly as they don't in the render,
  // and the clip's source window drops words trimmed out of the clip.
  const activeSubtitles = useMemo(() => {
    if (!showSubtitles) return [];
    const active: Array<{
      channelId: string;
      transcripts: (typeof transcriptsByMedia)[string];
      mediaTime: number;
      clipStart: number;
      clipEnd: number;
    }> = [];
    for (const channel of playback?.channels ?? []) {
      if (channel.isMuted) continue;
      const clip = findActiveClip(channel.mediaClips, currentTime);
      const mediaId = clip?.clip.MediaRef;
      if (!clip || !mediaId) continue;
      const transcripts = transcriptsByMedia[mediaId];
      if (!transcripts || transcripts.length === 0) continue;
      active.push({
        channelId: channel.trackId ?? `layer-${channel.layer}`,
        transcripts,
        // cuesFromTranscripts cues are in absolute media time
        mediaTime: currentTime - clip.globalStart + clip.clip.start,
        clipStart: clip.clip.start,
        clipEnd: clip.clip.end,
      });
    }
    return active;
  }, [showSubtitles, playback, currentTime, transcriptsByMedia]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      lastUpdateRef.current = 0;
      return;
    }

    let animationFrame: number;

    const update = (timestamp: number) => {
      if (!lastUpdateRef.current) {
        lastUpdateRef.current = timestamp;
      }

      const delta = (timestamp - lastUpdateRef.current) / 1000;
      lastUpdateRef.current = timestamp;

      // A stalled channel freezes the shared clock: the playhead waits for
      // the buffer instead of running ahead of what the players can render.
      if (!stallRegistry.anyStalled()) {
        setCurrentTime((prev) => {
          const next = prev + delta;
          if (next >= duration) {
            setIsPlaying(false);
            return duration;
          }
          return next;
        });
      }

      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, duration, setCurrentTime, setIsPlaying, stallRegistry]);

  // UI Control Handlers
  const togglePlay = () => setIsPlaying(!isPlaying);
  const skipForward = () => setCurrentTime(Math.min(duration, currentTime + 5));
  const skipBack = () => setCurrentTime(Math.max(0, currentTime - 5));

  if (!timeline) return null;

  const isPortrait = timeline.orientation === TimelineOrientation.PORTRAIT;

  // Width is the definite dimension and height comes from the aspect ratio, so
  // the stage is sized as min(available width, available height × ratio). That
  // fits both axes without ever breaking the ratio — which matters because the
  // caption/transcript overlays are positioned against this box. 100cqh reads
  // the stage wrapper's height, so the transport row below must stay OUTSIDE
  // the container or it would be counted twice. 20rem/56rem preserve the
  // previous max-w-xs / max-w-4xl caps.
  const stageClass = isPortrait
    ? 'aspect-[9/16] w-[min(100%,20rem,calc(100cqh*9/16))]'
    : 'aspect-video w-[min(100%,56rem,calc(100cqh*16/9))]';

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 lg:gap-4">
      <div className="flex flex-1 min-h-0 items-center justify-center [container-type:size]">
        <div
          className={`relative ${stageClass} max-h-full bg-black rounded-lg overflow-hidden shadow-2xl border border-white/10 group`}
        >
          {/* One video element per track, stacked by layer */}
          {videoTracks.map((track, i) => (
            <TrackVideo
              key={track.trackId ?? `layer-${track.layer}`}
              track={track}
              zIndex={i}
              currentTime={currentTime}
              isPlaying={isPlaying}
              muted={isMuted}
              stallRegistry={stallRegistry}
            />
          ))}

          {/* Buffering indicator: a channel can't render the playhead frame */}
          {isBuffering && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <Loader2 className="h-10 w-10 animate-spin text-white/80" />
            </div>
          )}

          {/* Caption overlays (ad-hoc captions and title screens) */}
          {activeCaptions.map(({ clipId, caption, localTime }) => (
            <CaptionOverlay
              key={clipId}
              className="z-10"
              text={caption.text}
              cues={(caption.cues ?? undefined) as CaptionCue[] | undefined}
              style={(caption.style ?? undefined) as CaptionStyle | undefined}
              currentTime={localTime}
            />
          ))}

          {/* Auto subtitle overlays (speech-to-text), toggled + mute-aware */}
          {activeSubtitles.map(
            ({ channelId, transcripts, mediaTime, clipStart, clipEnd }) => (
              <TranscriptOverlay
                key={`sub-${channelId}`}
                className="z-10"
                transcripts={transcripts}
                currentTime={mediaTime}
                windowStart={clipStart}
                windowEnd={clipEnd}
                isVisible
              />
            )
          )}

          {/* Overlay Controls. Hover-gated, so desktop-only — on touch it never
            appeared, and it would blanket a 129px-wide portrait stage. The
            transport row below is the universal path. */}
          <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity hidden lg:flex flex-col justify-end p-4">
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={skipBack}
              >
                <SkipBack className="h-6 w-6" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-12 w-12"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <Pause className="h-8 w-8 fill-current" />
                ) : (
                  <Play className="h-8 w-8 fill-current" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={skipForward}
              >
                <SkipForward className="h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* External Controls */}
      <div className="shrink-0 flex h-10 items-center justify-between gap-2 px-2 lg:h-auto">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          {/* Skip lives in the hover overlay on desktop; touch needs it here. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 lg:hidden"
            onClick={skipBack}
            aria-label="Back 5 seconds"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 sm:mr-2" />
            ) : (
              <Play className="h-4 w-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">
              {isPlaying ? 'Pause' : 'Play'}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 lg:hidden"
            onClick={skipForward}
            aria-label="Forward 5 seconds"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMuted(!isMuted)}
            aria-label={isMuted ? 'Unmute preview' : 'Mute preview'}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSubtitles((prev) => !prev)}
            title={
              showSubtitles
                ? 'Hide auto subtitles'
                : 'Show auto subtitles (skips muted tracks)'
            }
            aria-label={
              showSubtitles ? 'Hide auto subtitles' : 'Show auto subtitles'
            }
            aria-pressed={showSubtitles}
          >
            {showSubtitles ? (
              <Captions className="h-4 w-4" />
            ) : (
              <CaptionsOff className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          {/* Phones hide the timeline pane's caption row, so the clock moves
              here rather than disappearing. */}
          <span className="ml-1 shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:hidden">
            {formatTimecode(currentTime)} / {formatTimecode(duration)}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {droppedChannelCount > 0 && (
            <>
              {/* The sentence can't share a 375px row with the transport, so
                  below sm it collapses to an icon carrying the same text. */}
              <div
                className="hidden sm:block text-xs font-medium text-amber-600 bg-amber-100 dark:bg-amber-950 px-2 py-1 rounded"
                title="Nested timelines need one player per inner track. Tracks beyond the limit are muted and hidden in the preview only — renders always include everything."
              >
                Preview limited to {MAX_PLAYBACK_CHANNELS} players —{' '}
                {droppedChannelCount} track
                {droppedChannelCount === 1 ? '' : 's'} not shown
              </div>
              <span
                className="sm:hidden shrink-0 text-amber-600"
                title={`Preview limited to ${MAX_PLAYBACK_CHANNELS} players — ${droppedChannelCount} track${droppedChannelCount === 1 ? '' : 's'} not shown. Renders always include everything.`}
                aria-label={`Preview limited to ${MAX_PLAYBACK_CHANNELS} players — ${droppedChannelCount} track${droppedChannelCount === 1 ? '' : 's'} not shown. Renders always include everything.`}
              >
                <AlertTriangle className="h-4 w-4" />
              </span>
            </>
          )}
          {/* Redundant chrome on a phone: the preview is always proxy. */}
          <div className="hidden sm:block text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
            Preview Quality: Proxy
          </div>
        </div>
      </div>
    </div>
  );
}
