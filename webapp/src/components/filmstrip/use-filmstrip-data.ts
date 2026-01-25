import { useState, useEffect } from 'react';
import type { Media, MediaRelations, Expanded, File } from '@project/shared';
import pb from '@/lib/pocketbase-client';

export interface FilmstripConfig {
  segmentIndex: number;
  startTime: number;
  cols: number;
  rows: number;
  fps: number;
  tileWidth: number;
  tileHeight: number;
}

export function useFilmstripData<
  E extends keyof MediaRelations = 'filmstripFileRefs',
>(media: Media | Expanded<Media, MediaRelations, E>) {
  const [filmstrips, setFilmstrips] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const mediaExpand = 'expand' in media ? media.expand : undefined;
  const mediaId = media.id;
  const mediaFilmstripFileRefs = media.filmstripFileRefs;

  useEffect(() => {
    async function fetchFilmstrips() {
      // Check if we already have expanded filmstrips
      const expanded =
        mediaExpand && 'filmstripFileRefs' in mediaExpand
          ? (mediaExpand.filmstripFileRefs as File[] | undefined)
          : undefined;
      if (expanded && Array.isArray(expanded) && expanded.length > 0) {
        // Sort expanded files just in case
        const sorted = [...expanded].sort((a: File, b: File) => {
          const idxA = a.meta?.filmstripConfig?.segmentIndex ?? 0;
          const idxB = b.meta?.filmstripConfig?.segmentIndex ?? 0;
          return idxA - idxB;
        });
        setFilmstrips(sorted);
        return;
      }

      // If no refs, nothing to fetch
      if (!mediaFilmstripFileRefs || mediaFilmstripFileRefs.length === 0) {
        setFilmstrips([]);
        return;
      }

      setIsLoading(true);
      try {
        // Fetch files related to this media that are filmstrips
        // Using MediaRef is more reliable than constructing a massive OR filter for IDs
        const files = await pb.collection('Files').getFullList<File>({
          filter: `MediaRef = "${mediaId}" && fileType = "filmstrip"`,
          sort: 'created',
        });

        const sorted = files.sort((a: File, b: File) => {
          const idxA = a.meta?.filmstripConfig?.segmentIndex ?? 0;
          const idxB = b.meta?.filmstripConfig?.segmentIndex ?? 0;
          return idxA - idxB;
        });

        setFilmstrips(sorted);
      } catch (error) {
        console.error('Failed to fetch filmstrip files:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchFilmstrips();
  }, [mediaId, mediaFilmstripFileRefs, mediaExpand]);

  const getFilmstripForTime = (time: number) => {
    if (!filmstrips.length) return null;

    // Optimization: Calculate index directly if segments are consistent
    // But since we can't guarantee every segment exists or is consistent without checking,
    // we'll search. Since the list is small (e.g. 100 items for 3 hours), find is fast enough.

    // We try to find the segment where time falls within [startTime, startTime + duration)
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
    isLoading,
    getFilmstripForTime,
  };
}
