import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  evenTileHeight,
  mediaDisplayDimensions,
  normalizeFilmstripSegments,
  segmentForTime,
  type Media,
  type MediaRelations,
  type Expanded,
  type File,
} from '@project/shared';
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

/**
 * Pair each normalized segment back up with its File record (the viewer needs
 * the record to build a PocketBase file URL). Ordering, the 1 fps default and
 * the derived segmentIndex/startTime for pre-metadata records all come from
 * the shared helper — the same one `vw frame` crops with.
 *
 * `tileHeight` is recomputed from the media's display aspect whenever that is
 * known: the generator scales tiles to it, but records written before the
 * worker persisted its real geometry carry the *requested* height instead
 * (e.g. 180 against a 320px tile, wrong for anything but 16:9). The viewer
 * positions a CSS background over the whole sheet, so it has to derive that
 * height rather than measure it the way `vw frame` does when it decodes.
 */
function normalizeFilmstrips(
  files: File[],
  displayAspect: number
): NormalizedFilmstrip[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  return normalizeFilmstripSegments(files).flatMap(({ fileId, config }) => {
    const file = byId.get(fileId);
    if (!file) return [];
    const tileWidth = file.meta?.filmstripConfig?.tileWidth ?? 0;
    return [
      {
        file,
        config: {
          ...config,
          tileWidth,
          tileHeight:
            evenTileHeight(tileWidth, displayAspect) ||
            (file.meta?.filmstripConfig?.tileHeight ?? 0),
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

  const displayAspect = mediaDisplayDimensions(media).aspect;

  const filmstrips = useMemo(
    () =>
      normalizeFilmstrips(
        hasExpanded ? (expandedFilmstrips ?? []) : (query.data ?? []),
        displayAspect
      ),
    [hasExpanded, expandedFilmstrips, query.data, displayAspect]
  );

  const getFilmstripForTime = (time: number): NormalizedFilmstrip | null => {
    if (!filmstrips.length) return null;
    const match = segmentForTime(
      filmstrips.map(({ file, config }) => ({ fileId: file.id, config })),
      time
    );
    return filmstrips.find((f) => f.file.id === match?.fileId) ?? null;
  };

  return {
    filmstrips,
    isLoading: query.isLoading,
    getFilmstripForTime,
  };
}
