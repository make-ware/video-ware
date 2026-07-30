import { useQuery } from '@tanstack/react-query';
import {
  mediaDisplayDimensions,
  type Media,
  type MediaRelations,
  type Expanded,
  type File,
} from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';

export interface SpriteConfig {
  cols: number; // Fixed at 10
  rows: number; // Dynamic based on video duration (up to 250 for 2500 frames)
  fps: number; // Fixed at 1
  tileWidth?: number; // Fixed at 320px
  tileHeight?: number; // Dynamic based on aspect ratio
}

/**
 * Aspect ratio (width/height) of a single sprite tile, or null when it can't be
 * determined.
 *
 * The generator always scales tiles to the source's *display* aspect ratio, so
 * the media row is the authoritative statement of a tile's shape — and unlike
 * the stored config it is also correct for sheets written before the worker
 * recorded its real geometry (those carry the *requested* tileHeight, e.g. 180
 * against a 320px tile, which is wrong for anything that isn't 16:9). The
 * stored tile dimensions are the fallback for media with unknown dimensions.
 */
export function spriteTileAspect(
  media: Pick<Media, 'width' | 'height' | 'rotation' | 'mediaData'>,
  config: SpriteConfig
): number | null {
  const { aspect } = mediaDisplayDimensions(media);
  if (aspect > 0) return aspect;

  const { tileWidth, tileHeight } = config;
  if (tileWidth && tileHeight && tileWidth > 0 && tileHeight > 0) {
    return tileWidth / tileHeight;
  }
  return null;
}

export function useSpriteData<E extends keyof MediaRelations = 'spriteFileRef'>(
  media: Media | Expanded<Media, MediaRelations, E>,
  initialSpriteFile?: File
) {
  const spriteFileFromExpand =
    'expand' in media && media.expand && 'spriteFileRef' in media.expand
      ? (media.expand.spriteFileRef as File | undefined)
      : undefined;

  // Prefer a sprite file we already have (passed in or expanded); only fetch
  // when neither is available and a ref exists.
  const preloaded = initialSpriteFile ?? spriteFileFromExpand ?? null;
  const spriteFileRef = media.spriteFileRef;

  const query = useQuery({
    queryKey: qk.files.sprite(spriteFileRef ?? ''),
    enabled: !preloaded && !!spriteFileRef,
    queryFn: () => pb.collection('Files').getOne<File>(spriteFileRef!),
  });

  const spriteFile = preloaded ?? query.data ?? null;

  const config: SpriteConfig = spriteFile?.meta?.spriteConfig || {
    cols: 10,
    rows: 10,
    fps: 1,
  };

  const url = spriteFile?.file
    ? pb.files.getURL(spriteFile, spriteFile.file)
    : null;

  return {
    spriteFile,
    url,
    config,
    tileAspect: spriteTileAspect(media, config),
    isLoading: query.isLoading,
  };
}
