'use client';

import { TracksAnimator } from '@/components/labels/tracks-animator';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { useTimeAnimation } from '@/hooks/use-time-animation';
import type { LabelTrack, Media } from '@project/shared';

/**
 * Animated preview of a label's time range: with a track, a filmstrip frame
 * with the track's bounding-box overlay; without one, a looping filmstrip of
 * the range. Falls back to a placeholder when the media (or its filmstrips)
 * is unavailable.
 */
export function LabelPreview({
  media,
  track,
  start,
  end,
}: {
  media?: Media | null;
  track?: LabelTrack | null;
  start: number;
  end: number;
}) {
  if (!media || !media.filmstripFileRefs?.length) {
    return (
      <div className="flex items-center justify-center aspect-video bg-muted/30 rounded-lg text-sm text-muted-foreground">
        No media preview available.
      </div>
    );
  }

  if (track) {
    return <TracksAnimator media={media} track={track} />;
  }

  return (
    <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
      <LabelRangeFilmstrip media={media} start={start} end={end} />
    </div>
  );
}

function LabelRangeFilmstrip({
  media,
  start,
  end,
}: {
  media: Media;
  start: number;
  end: number;
}) {
  const currentTime = useTimeAnimation({
    start,
    end,
    enabled: true,
    loop: true,
  });

  return (
    <FilmstripViewer
      media={media}
      currentTime={currentTime}
      className="w-full h-full"
    />
  );
}
