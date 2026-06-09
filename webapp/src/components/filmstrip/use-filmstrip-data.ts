import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Media, MediaRelations, Expanded, File } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';

export interface FilmstripConfig {
  segmentIndex: number;
  startTime: number;
  cols: number;
  rows: number;
  fps: number;
  tileWidth: number;
  tileHeight: number;
}

function sortBySegment(files: File[]): File[] {
  return [...files].sort((a, b) => {
    const idxA = a.meta?.filmstripConfig?.segmentIndex ?? 0;
    const idxB = b.meta?.filmstripConfig?.segmentIndex ?? 0;
    return idxA - idxB;
  });
}

export function useFilmstripData<
  E extends keyof MediaRelations = 'filmstripFileRefs',
>(media: Media | Expanded<Media, MediaRelations, E>) {
  const mediaExpand = 'expand' in media ? media.expand : undefined;
  const mediaId = media.id;
  const mediaFilmstripFileRefs = media.filmstripFileRefs;

  const expandedFilmstrips =
    mediaExpand && 'filmstripFileRefs' in mediaExpand
      ? (mediaExpand.filmstripFileRefs as File[] | undefined)
      : undefined;
  const hasExpanded =
    Array.isArray(expandedFilmstrips) && expandedFilmstrips.length > 0;
  const hasRefs = !!mediaFilmstripFileRefs && mediaFilmstripFileRefs.length > 0;

  // Using MediaRef is more reliable than constructing a massive OR filter for IDs.
  const query = useQuery({
    queryKey: qk.files.filmstrip(mediaId),
    enabled: !hasExpanded && hasRefs,
    queryFn: () =>
      pb.collection('Files').getFullList<File>({
        filter: `MediaRef = "${mediaId}" && fileType = "filmstrip"`,
        sort: 'created',
      }),
  });

  const filmstrips = useMemo(
    () =>
      sortBySegment(
        hasExpanded ? (expandedFilmstrips ?? []) : (query.data ?? [])
      ),
    [hasExpanded, expandedFilmstrips, query.data]
  );

  const getFilmstripForTime = (time: number) => {
    if (!filmstrips.length) return null;

    // The list is small (e.g. 100 items for 3 hours), so a linear search for
    // the segment where time falls within [startTime, startTime + duration) is fine.
    return filmstrips.find((f) => {
      const config = f.meta?.filmstripConfig as FilmstripConfig | undefined;
      if (!config) return false;

      const totalFrames = config.cols * config.rows;
      const duration = totalFrames / config.fps;

      return time >= config.startTime && time < config.startTime + duration;
    });
  };

  return {
    filmstrips,
    isLoading: query.isLoading,
    getFilmstripForTime,
  };
}
