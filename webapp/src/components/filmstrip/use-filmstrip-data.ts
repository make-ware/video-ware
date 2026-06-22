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

export interface NormalizedFilmstrip {
  file: File;
  /** Config with every field guaranteed present (defaults filled in). */
  config: FilmstripConfig;
}

// Filmstrips are always sampled at 1 frame per second today. Older File
// records were written without fps/startTime/segmentIndex, so we fall back to
// these so they stay renderable without re-processing.
const DEFAULT_FPS = 1;

/**
 * Normalize raw filmstrip File records into segments with a complete config.
 *
 * Segments are ordered by `segmentIndex` when present, otherwise by their
 * incoming order (creation order, which matches segment order since the worker
 * emits segments sequentially). Missing `fps`/`startTime`/`segmentIndex` are
 * derived so that records written before those fields existed still resolve.
 */
function normalizeFilmstrips(files: File[]): NormalizedFilmstrip[] {
  const ordered = [...files].sort((a, b) => {
    const idxA = a.meta?.filmstripConfig?.segmentIndex ?? 0;
    const idxB = b.meta?.filmstripConfig?.segmentIndex ?? 0;
    return idxA - idxB;
  });

  return ordered.flatMap((file, index) => {
    const raw = file.meta?.filmstripConfig as
      | Partial<FilmstripConfig>
      | undefined;
    if (!raw?.cols || !raw?.rows) return [];

    const fps = raw.fps ?? DEFAULT_FPS;
    const segmentDuration = (raw.cols * raw.rows) / fps;
    const segmentIndex = raw.segmentIndex ?? index;
    const startTime = raw.startTime ?? segmentIndex * segmentDuration;

    return [
      {
        file,
        config: {
          cols: raw.cols,
          rows: raw.rows,
          tileWidth: raw.tileWidth ?? 0,
          tileHeight: raw.tileHeight ?? 0,
          fps,
          segmentIndex,
          startTime,
        },
      },
    ];
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

  // Resolve filmstrips by their explicit ids. This is robust whether or not the
  // File's MediaRef is populated (older records were created without it), and
  // the id list is small (one segment per 100s of media).
  const query = useQuery({
    queryKey: qk.files.filmstrip(mediaId),
    enabled: !hasExpanded && hasRefs,
    queryFn: () => {
      const filter = (mediaFilmstripFileRefs ?? [])
        .map((id) => `id = "${id}"`)
        .join(' || ');
      return pb.collection('Files').getFullList<File>({
        filter,
        sort: 'created',
      });
    },
  });

  const filmstrips = useMemo(
    () =>
      normalizeFilmstrips(
        hasExpanded ? (expandedFilmstrips ?? []) : (query.data ?? [])
      ),
    [hasExpanded, expandedFilmstrips, query.data]
  );

  const getFilmstripForTime = (time: number): NormalizedFilmstrip | null => {
    if (!filmstrips.length) return null;

    // The list is small (e.g. 100 items for 3 hours), so a linear search for
    // the segment where time falls within [startTime, startTime + duration) is fine.
    const match = filmstrips.find(({ config }) => {
      const totalFrames = config.cols * config.rows;
      const duration = totalFrames / config.fps;
      return time >= config.startTime && time < config.startTime + duration;
    });

    return match ?? null;
  };

  return {
    filmstrips,
    isLoading: query.isLoading,
    getFilmstripForTime,
  };
}
