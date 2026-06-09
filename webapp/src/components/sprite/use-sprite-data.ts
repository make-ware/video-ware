import { useQuery } from '@tanstack/react-query';
import type { Media, MediaRelations, Expanded, File } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';

export interface SpriteConfig {
  cols: number; // Fixed at 10
  rows: number; // Dynamic based on video duration (up to 250 for 2500 frames)
  fps: number; // Fixed at 1
  tileWidth?: number; // Fixed at 320px
  tileHeight?: number; // Dynamic based on aspect ratio
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
    isLoading: query.isLoading,
  };
}
