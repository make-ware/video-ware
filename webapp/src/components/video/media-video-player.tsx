'use client';

import React, { forwardRef } from 'react';
import type {
  Media,
  MediaRelations,
  Expanded,
  MediaClip,
} from '@project/shared';
import { useVideoSource } from '@/hooks/use-video-source';
import { VideoPlayerUI } from './video-player-ui';

interface MediaVideoPlayerProps<
  E extends keyof MediaRelations = 'proxyFileRef' | 'thumbnailFileRef',
> {
  media: Media | Expanded<Media, MediaRelations, E>;
  clip?: MediaClip;
  autoPlay?: boolean;
  className?: string;
  onTimeUpdate?: (time: number) => void;
  children?: React.ReactNode | ((currentTime: number) => React.ReactNode);
}

export const MediaVideoPlayer = forwardRef<
  HTMLVideoElement,
  MediaVideoPlayerProps
>(
  (
    { media, clip, autoPlay = false, className, onTimeUpdate, children },
    ref
  ) => {
    const { src, poster, startTime, endTime, isLoading } = useVideoSource(
      media,
      clip
    );

    if (isLoading) {
      return (
        <div
          className={`flex items-center justify-center bg-black rounded-lg aspect-video ${className}`}
        >
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      );
    }

    if (!src) {
      return (
        <div
          className={`flex items-center justify-center bg-muted rounded-lg aspect-video ${className}`}
        >
          <p className="text-muted-foreground">No video source available</p>
        </div>
      );
    }

    return (
      <VideoPlayerUI
        ref={ref}
        src={src}
        poster={poster}
        startTime={startTime}
        endTime={endTime}
        autoPlay={autoPlay}
        className={className}
        onTimeUpdate={onTimeUpdate}
      >
        {children}
      </VideoPlayerUI>
    );
  }
);

MediaVideoPlayer.displayName = 'MediaVideoPlayer';
