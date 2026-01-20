'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import pb from '@/lib/pocketbase-client';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Media } from '@project/shared';

export function TimelinePlayer() {
  const {
    timeline,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    duration,
  } = useTimeline();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeMedia, setActiveMedia] = useState<Media | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const lastUpdateRef = useRef<number>(0);

  // Map clips to global timeline offsets
  const clipRanges = useMemo(() => {
    if (!timeline) return [];
    let accumulated = 0;
    return timeline.clips.map((clip) => {
      const clipDuration = clip.end - clip.start;
      const range = {
        clipId: clip.id,
        mediaId: clip.MediaRef,
        globalStart: accumulated,
        globalEnd: accumulated + clipDuration,
        localStart: clip.start,
        localEnd: clip.end,
      };
      accumulated += clipDuration;
      return range;
    });
  }, [timeline]);

  // Find current clip
  const currentRange = useMemo(() => {
    return (
      clipRanges.find(
        (r) => currentTime >= r.globalStart && currentTime < r.globalEnd
      ) || clipRanges[0]
    );
  }, [clipRanges, currentTime]);

  // Fetch media for the current clip
  useEffect(() => {
    if (!currentRange) return;

    const fetchMedia = async () => {
      try {
        const media = await pb.collection('Media').getOne(currentRange.mediaId);
        setActiveMedia(media as unknown as Media);
      } catch (err) {
        console.error('Failed to fetch media for player:', err);
      }
    };

    if (activeMedia?.id !== currentRange.mediaId) {
      fetchMedia();
    }
  }, [currentRange, activeMedia?.id]);

  // Proxy/Source handling
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMedia) {
      // If activeMedia becomes null, we want to clear the videoSrc.
      // This will be handled in the cleanup function.
      return;
    }

    const isMounted = true;
    const loadVideoSrc = async () => {
      try {
        // If we have a proxy, use it
        if (activeMedia.proxyFileRef) {
          const fileRef = await pb
            .collection('Files')
            .getOne(activeMedia.proxyFileRef);
          if (isMounted) {
            setVideoSrc(
              pb.files.getURL(fileRef, (fileRef as { file: string }).file)
            );
          }
        } else {
          // Fallback to original if proxy not available (might not work if original is too large)
          // In a real app, we'd ensure proxy exists
          setVideoSrc(null);
        }
      } catch (err) {
        console.error('Failed to load video source:', err);
        setVideoSrc(null);
      }
    };

    loadVideoSrc();
  }, [activeMedia]);

  // Sync video time and playback state with global time
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentRange) return;

    const localTime =
      currentTime - currentRange.globalStart + currentRange.localStart;

    // Only seek if the difference is significant to avoid jitter
    if (Math.abs(video.currentTime - localTime) > 0.3) {
      video.currentTime = localTime;
    }

    // Sync playback state
    if (isPlaying && video.paused) {
      video.play().catch(() => {}); // Ignore play errors
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [currentTime, currentRange, isPlaying]);

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

      setCurrentTime((prev) => {
        const next = prev + delta;
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return next;
      });

      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, duration, setCurrentTime, setIsPlaying]);

  // UI Control Handlers
  const togglePlay = () => setIsPlaying(!isPlaying);
  const skipForward = () => setCurrentTime(Math.min(duration, currentTime + 5));
  const skipBack = () => setCurrentTime(Math.max(0, currentTime - 5));

  if (!timeline) return null;

  return (
    <div className="flex flex-col gap-2 lg:gap-4 w-full max-w-4xl mx-auto">
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden shadow-2xl border border-white/10 group">
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="w-full h-full object-contain"
            muted={isMuted}
            playsInline
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground animate-pulse">
            Loading preview...
          </div>
        )}

        {/* Overlay Controls */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
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

      {/* External Controls */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={togglePlay}>
            {isPlaying ? (
              <Pause className="h-4 w-4 mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMuted(!isMuted)}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
          Preview Quality: Proxy
        </div>
      </div>
    </div>
  );
}
