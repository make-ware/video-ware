import { useState, useEffect } from 'react';
import type { Media, MediaRelations, Expanded, File } from '@project/shared';
import pb from '@/lib/pocketbase-client';

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

  const [spriteFile, setSpriteFile] = useState<File | null>(
    initialSpriteFile ?? spriteFileFromExpand ?? null
  );
  const [isLoading, setIsLoading] = useState(
    !spriteFile && !!media.spriteFileRef
  );

  useEffect(() => {
    async function fetchSpriteFile() {
      // If we already have the sprite file from expand, don't fetch it again
      if (spriteFile || !media.spriteFileRef) {
        if (isLoading) setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const file = await pb
          .collection('Files')
          .getOne<File>(media.spriteFileRef);
        setSpriteFile(file);
      } catch (error) {
        console.error('Failed to fetch sprite file:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSpriteFile();
  }, [media.spriteFileRef, spriteFile, isLoading]);

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
    isLoading,
  };
}
