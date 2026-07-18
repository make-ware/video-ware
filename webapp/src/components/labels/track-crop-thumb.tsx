'use client';

import { useMemo } from 'react';
import type { LabelTrack, Media } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { cn } from '@/lib/utils';
import { useFilmstripData } from '@/components/filmstrip/use-filmstrip-data';
import {
  bboxCropRegion,
  cropBackground,
  interpolateBbox,
  normalizeKeyframes,
  tileFrameTime,
} from './keyframes';

interface TrackCropThumbProps {
  media: Media;
  track: LabelTrack;
  /** Sizing/rounding; the component fills it with the cropped frame. */
  className?: string;
  /**
   * Displayed width/height of the container the crop fills (default 1,
   * a square avatar). Pass e.g. 16/9 for a banner-shaped thumbnail.
   */
  displayAspect?: number;
}

/**
 * Static thumbnail of a label track's subject: the filmstrip frame nearest
 * the track's midpoint, cropped to the track's bounding box (padded to a
 * region matching the container's display aspect — square by default).
 * Gives face/person/object rows a recognizable image without playing the
 * animated preview.
 */
export function TrackCropThumb({
  media,
  track,
  className,
  displayAspect = 1,
}: TrackCropThumbProps) {
  const { getFilmstripForTime, isLoading } = useFilmstripData(media);

  const sorted = useMemo(
    () => normalizeKeyframes(track.keyframes, track.start),
    [track.keyframes, track.start]
  );

  const midTime = (track.start + track.end) / 2;
  const strip = getFilmstripForTime(midTime);

  const crop = useMemo(() => {
    if (!strip || sorted.length === 0) return null;
    // Interpolate the bbox at the timestamp of the frame actually shown, so
    // box and image line up even though the filmstrip samples at ~1fps.
    const frameTime = Math.min(
      Math.max(tileFrameTime(strip.config, midTime), track.start),
      track.end
    );
    const bbox = interpolateBbox(sorted, frameTime - track.start);
    if (!bbox) return null;
    const aspect =
      media.aspectRatio ||
      (media.width && media.height ? media.width / media.height : 16 / 9);
    const region = bboxCropRegion(bbox, aspect, displayAspect);
    if (!region) return null;
    return cropBackground(strip.config, midTime, region);
  }, [strip, sorted, midTime, track.start, track.end, media, displayAspect]);

  if (!crop || !strip) {
    return (
      <div
        className={cn(
          'bg-muted shrink-0',
          isLoading && 'animate-pulse',
          className
        )}
        aria-hidden
      />
    );
  }

  const url = pb.files.getURL(strip.file, strip.file.file as string);

  return (
    <div
      className={cn('bg-muted shrink-0 overflow-hidden', className)}
      style={{
        backgroundImage: `url('${url}')`,
        backgroundRepeat: 'no-repeat',
        ...crop,
      }}
      role="img"
      aria-label={`Thumbnail at ${midTime.toFixed(1)}s`}
    />
  );
}
