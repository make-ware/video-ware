import { useState, useEffect, useMemo } from 'react';
import type {
  Media,
  MediaRelations,
  Expanded,
  MediaClip,
  File,
} from '@project/shared';
import pb from '@/lib/pocketbase-client';

export interface VideoSource {
  src: string;
  poster: string;
  startTime: number;
  endTime?: number;
  isLoading: boolean;
}

export function useVideoSource<
  E extends keyof MediaRelations = 'proxyFileRef' | 'thumbnailFileRef',
>(
  media: Media | Expanded<Media, MediaRelations, E> | null | undefined,
  clip?: MediaClip
): VideoSource {
  const proxyFileFromExpand =
    media && 'expand' in media && media.expand && 'proxyFileRef' in media.expand
      ? (media.expand.proxyFileRef as File | undefined)
      : undefined;
  const thumbnailFileFromExpand =
    media &&
    'expand' in media &&
    media.expand &&
    'thumbnailFileRef' in media.expand
      ? (media.expand.thumbnailFileRef as File | undefined)
      : undefined;

  const [proxyFile, setProxyFile] = useState<File | null>(
    proxyFileFromExpand ?? null
  );
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(
    thumbnailFileFromExpand ?? null
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const currentMedia = media;
    if (!currentMedia) return;

    type MediaParam = NonNullable<typeof media>;
    async function fetchFiles(m: MediaParam) {
      const needsProxy = !proxyFile && !!m.proxyFileRef;
      const needsThumbnail = !thumbnailFile && !!m.thumbnailFileRef;

      if (!needsProxy && !needsThumbnail) return;

      setIsLoading(true);
      try {
        if (needsProxy) {
          const file = await pb
            .collection('Files')
            .getOne<File>(m.proxyFileRef!);
          setProxyFile(file);
        }
        if (needsThumbnail) {
          const file = await pb
            .collection('Files')
            .getOne<File>(m.thumbnailFileRef!);
          setThumbnailFile(file);
        }
      } catch (error) {
        console.error('Failed to fetch video files:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchFiles(currentMedia);
  }, [
    media,
    media?.proxyFileRef,
    media?.thumbnailFileRef,
    proxyFile,
    thumbnailFile,
  ]);

  const src = useMemo(() => {
    if (!proxyFile?.file) return '';
    try {
      return pb.files.getURL(proxyFile, proxyFile.file);
    } catch (error) {
      console.error('Failed to get proxy URL:', error);
      return '';
    }
  }, [proxyFile]);

  const poster = useMemo(() => {
    if (!thumbnailFile?.file) return '';
    try {
      return pb.files.getURL(thumbnailFile, thumbnailFile.file);
    } catch (error) {
      console.error('Failed to get thumbnail URL:', error);
      return '';
    }
  }, [thumbnailFile]);

  if (!media) {
    return {
      src: '',
      poster: '',
      startTime: clip?.start ?? 0,
      endTime: clip?.end,
      isLoading: false,
    };
  }

  return {
    src,
    poster,
    startTime: clip?.start ?? 0,
    endTime: clip?.end,
    isLoading,
  };
}
