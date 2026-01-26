'use client';

import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useCallback,
} from 'react';
import { cn } from '@/lib/utils';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export interface VideoPlayerUIProps {
  src: string;
  poster?: string;
  startTime?: number;
  endTime?: number;
  autoPlay?: boolean;
  /**
   * If false, `startTime` is only applied once when the `src` becomes ready,
   * and the parent is expected to scrub via the forwarded <video> ref.
   * This avoids seek loops during drag scrubbing.
   */
  seekOnStartTimeChange?: boolean;
  /** Controls browser buffering behavior for better scrubbing UX. */
  preload?: HTMLVideoElement['preload'];
  className?: string;
  onTimeUpdate?: (time: number) => void;
  children?: React.ReactNode | ((currentTime: number) => React.ReactNode);
}

export const VideoPlayerUI = forwardRef<HTMLVideoElement, VideoPlayerUIProps>(
  (
    {
      src,
      poster,
      startTime = 0,
      endTime,
      autoPlay = false,
      seekOnStartTimeChange = true,
      preload = 'metadata',
      className,
      onTimeUpdate,
      children,
    },
    forwardedRef
  ) => {
    const internalRef = useRef<HTMLVideoElement>(null);
    const lastSrcRef = useRef<string | null>(null);
    const didInitialSeekRef = useRef(false);

    // Merge internal ref with forwarded ref
    const videoRef = (node: HTMLVideoElement | null) => {
      internalRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    };
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isReady, setIsReady] = useState(false);

    // Helper function to clamp time to boundaries
    const clampTime = useCallback(
      (time: number): number => {
        if (startTime !== undefined && time < startTime) {
          return startTime;
        }
        if (endTime !== undefined && time > endTime) {
          // Move to start time when exceeding end time (or 0 if startTime is undefined)
          return startTime !== undefined ? startTime : 0;
        }
        return time;
      },
      [startTime, endTime]
    );

    // Initial seek when the src becomes ready (always)
    useEffect(() => {
      const video = internalRef.current;
      if (!video || !isReady) return;

      if (lastSrcRef.current !== src) {
        lastSrcRef.current = src;
        didInitialSeekRef.current = false;
      }

      if (didInitialSeekRef.current) return;

      const performSeekAndPlay = async () => {
        try {
          const clampedTime = clampTime(startTime);
          if (Math.abs(video.currentTime - clampedTime) > 0.5) {
            video.currentTime = clampedTime;
          }

          if (autoPlay) {
            try {
              await video.play();
            } catch (err) {
              console.warn('Autoplay failed:', err);
              if (!video.muted) {
                video.muted = true;
                setIsMuted(true);
                try {
                  await video.play();
                } catch (mutedErr) {
                  console.warn('Muted autoplay failed:', mutedErr);
                }
              }
            }
          }
        } catch (err) {
          console.error('Error during seek/play sequence:', err);
        }
      };

      performSeekAndPlay();
      didInitialSeekRef.current = true;
    }, [src, autoPlay, isReady, startTime, clampTime]);

    // Optional: keep syncing to `startTime` on prop change (disabled during scrubbing UIs)
    useEffect(() => {
      if (!seekOnStartTimeChange) return;
      const video = internalRef.current;
      if (!video || !isReady) return;

      try {
        const clampedTime = clampTime(video.currentTime);
        if (Math.abs(video.currentTime - clampedTime) > 0.5) {
          video.currentTime = clampedTime;
        }
      } catch (err) {
        console.error('Error during startTime sync:', err);
      }
    }, [seekOnStartTimeChange, startTime, endTime, isReady, clampTime]);

    const handleTimeUpdate = () => {
      if (!internalRef.current) return;

      const video = internalRef.current;
      let time = video.currentTime;

      // Check if playhead is less than start time
      if (startTime !== undefined && time < startTime) {
        video.currentTime = startTime;
        time = startTime;
      }
      // Check if playhead is greater than end time
      else if (endTime !== undefined && time > endTime) {
        // Move to start time (or 0 if startTime is undefined)
        const targetTime = startTime !== undefined ? startTime : 0;
        // If playing, loop back to start and continue playing
        if (isPlaying) {
          video.currentTime = targetTime;
          time = targetTime;
          // Ensure it continues playing (in case the seek paused it)
          if (video.paused) {
            video.play().catch((err) => {
              console.warn('Failed to continue playing after loop:', err);
            });
          }
        } else {
          // If paused, just move to start time
          video.currentTime = targetTime;
          time = targetTime;
        }
      }

      setCurrentTime(time);
      onTimeUpdate?.(time);
    };

    const handleLoadedMetadata = (
      e: React.SyntheticEvent<HTMLVideoElement>
    ) => {
      setDuration(e.currentTarget.duration);
      setIsReady(true);
    };

    const togglePlay = async () => {
      if (!internalRef.current) return;
      try {
        if (isPlaying) {
          internalRef.current.pause();
        } else {
          await internalRef.current.play();
        }
      } catch (err) {
        console.error('Toggle play error:', err);
      }
    };

    const toggleMute = () => {
      if (!internalRef.current) return;
      internalRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    };

    const handleVolumeChange = (value: number[]) => {
      if (!internalRef.current) return;
      const newVolume = value[0];
      internalRef.current.volume = newVolume;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
    };

    const handleSeek = (value: number[]) => {
      if (!internalRef.current) return;
      const clampedTimeValue = clampTime(value[0]);
      internalRef.current.currentTime = clampedTimeValue;
      setCurrentTime(clampedTimeValue);
    };

    const formatTime = (time: number) => {
      const minutes = Math.floor(time / 60);
      const seconds = Math.floor(time % 60);
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
      <div
        className={cn(
          'relative group bg-black rounded-lg overflow-hidden',
          className
        )}
      >
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          preload={preload}
          className="w-full h-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          playsInline
        />

        {typeof children === 'function' ? children(currentTime) : children}

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="mb-4">
            <Slider
              value={[currentTime]}
              min={0}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlay}
                className="text-white hover:text-primary"
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6" />
                ) : (
                  <Play className="h-6 w-6" />
                )}
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMute}
                  className="text-white hover:text-primary"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </Button>
                <div className="w-20">
                  <Slider
                    value={[isMuted ? 0 : volume]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={handleVolumeChange}
                  />
                </div>
              </div>

              <span className="text-sm font-medium">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => internalRef.current?.requestFullscreen()}
              className="text-white hover:text-primary"
            >
              <Maximize className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {!isPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer"
            onClick={togglePlay}
          >
            <div className="bg-black/50 p-4 rounded-full backdrop-blur-sm hover:bg-black/70 transition-colors">
              <Play className="h-12 w-12 text-white fill-current" />
            </div>
          </div>
        )}
      </div>
    );
  }
);

VideoPlayerUI.displayName = 'VideoPlayerUI';
