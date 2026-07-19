'use client';

import React, { forwardRef } from 'react';
import {
  MediaType,
  type Media,
  type MediaRelations,
  type Expanded,
  type MediaClip,
} from '@project/shared';
import Image from 'next/image';
import { Music } from 'lucide-react';
import { useVideoSource } from '@/hooks/use-video-source';
import { VideoPlayerUI } from './video-player-ui';
import {
  MediaTypeIcon,
  normalizeMediaType,
} from '@/components/media/media-type-icon';

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

    const normalized = normalizeMediaType(media.mediaType);
    const isAudio = normalized === MediaType.AUDIO;
    const isImage = normalized === MediaType.IMAGE;
    const audioPlaceholder = isAudio ? (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-background to-primary/10">
        <Music className="h-16 w-16 text-primary/60" />
      </div>
    ) : undefined;

    if (isLoading) {
      return (
        <div
          className={`flex items-center justify-center bg-black rounded-lg aspect-video ${className}`}
        >
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      );
    }

    // Images have no playable source — render the generated thumbnail as a
    // static, fit-to-container preview (fall back to a type icon if missing).
    if (isImage) {
      return poster ? (
        <div
          className={`relative bg-black rounded-lg overflow-hidden ${className}`}
        >
          <Image
            src={poster}
            alt={media.label ?? 'Image preview'}
            fill
            unoptimized
            className="object-contain"
          />
        </div>
      ) : (
        <div
          className={`flex flex-col items-center justify-center gap-2 bg-muted rounded-lg aspect-video ${className}`}
        >
          <MediaTypeIcon
            mediaType={media.mediaType}
            className="h-16 w-16 text-muted-foreground/60"
          />
          <p className="text-muted-foreground text-sm">
            No image preview available
          </p>
        </div>
      );
    }

    if (!src) {
      return (
        <div
          className={`flex items-center justify-center bg-muted rounded-lg aspect-video ${className}`}
        >
          <p className="text-muted-foreground">
            {isAudio
              ? 'No audio source available'
              : 'No video source available'}
          </p>
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
        placeholder={audioPlaceholder}
        onTimeUpdate={onTimeUpdate}
      >
        {children}
      </VideoPlayerUI>
    );
  }
);

MediaVideoPlayer.displayName = 'MediaVideoPlayer';
