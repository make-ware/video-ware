'use client';

import { TracksAnimator } from '@/components/labels/tracks-animator';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { useTimeAnimation } from '@/hooks/use-time-animation';
import { cn } from '@/lib/utils';
import type { LabelTrack, Media } from '@project/shared';

/**
 * Animated preview of a label's time range: with a track, a filmstrip frame
 * with the track's bounding-box overlay; without one, a looping filmstrip of
 * the range. Falls back to a placeholder when the media (or its filmstrips)
 * is unavailable.
 *
 * `speed` scales the range sweep — label ranges are seconds long and read best
 * at 1×, but a whole-media range (a media tag) needs a compressed sweep to
 * loop in a watchable time.
 */
export function LabelPreview({
  media,
  track,
  start,
  end,
  speed,
  className,
}: {
  media?: Media | null;
  track?: LabelTrack | null;
  start: number;
  end: number;
  speed?: number;
  className?: string;
}) {
  if (!media || !media.filmstripFileRefs?.length) {
    return (
      <div
        className={cn(
          'flex items-center justify-center aspect-video bg-muted/30 rounded-lg text-sm text-muted-foreground',
          className
        )}
      >
        No media preview available.
      </div>
    );
  }

  if (track) {
    return <TracksAnimator media={media} track={track} className={className} />;
  }

  return (
    <div
      className={cn(
        'relative aspect-video bg-black rounded-lg overflow-hidden',
        className
      )}
    >
      <LabelRangeFilmstrip
        media={media}
        start={start}
        end={end}
        speed={speed}
      />
    </div>
  );
}

function LabelRangeFilmstrip({
  media,
  start,
  end,
  speed,
}: {
  media: Media;
  start: number;
  end: number;
  speed?: number;
}) {
  const currentTime = useTimeAnimation({
    start,
    end,
    enabled: true,
    loop: true,
    speed,
  });

  return (
    <FilmstripViewer
      media={media}
      currentTime={currentTime}
      className="w-full h-full"
    />
  );
}
