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
  E extends keyof MediaRelations =
    | 'proxyFileRef'
    | 'thumbnailFileRef'
    | 'audioFileRef',
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
  const audioFileFromExpand =
    media && 'expand' in media && media.expand && 'audioFileRef' in media.expand
      ? (media.expand.audioFileRef as File | undefined)
      : undefined;

  const [proxyFile, setProxyFile] = useState<File | null>(
    proxyFileFromExpand ?? null
  );
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(
    thumbnailFileFromExpand ?? null
  );
  const [audioFile, setAudioFile] = useState<File | null>(
    audioFileFromExpand ?? null
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const currentMedia = media;
    if (!currentMedia) return;

    type MediaParam = NonNullable<typeof media>;
    async function fetchFiles(m: MediaParam) {
      const needsProxy = !proxyFile && !!m.proxyFileRef;
      const needsThumbnail = !thumbnailFile && !!m.thumbnailFileRef;
      const needsAudio = !audioFile && !!m.audioFileRef;

      if (!needsProxy && !needsThumbnail && !needsAudio) return;

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
        if (needsAudio) {
          const file = await pb
            .collection('Files')
            .getOne<File>(m.audioFileRef!);
          setAudioFile(file);
        }
      } catch (error) {
        console.error('Failed to fetch media files:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchFiles(currentMedia);
  }, [
    media,
    media?.proxyFileRef,
    media?.thumbnailFileRef,
    media?.audioFileRef,
    proxyFile,
    thumbnailFile,
    audioFile,
  ]);

  const src = useMemo(() => {
    // Prefer proxy (video), then audio
    if (proxyFile?.file) {
      try {
        return pb.files.getURL(proxyFile, proxyFile.file);
      } catch (error) {
        console.error('Failed to get proxy URL:', error);
      }
    }
    if (audioFile?.file) {
      try {
        return pb.files.getURL(audioFile, audioFile.file);
      } catch (error) {
        console.error('Failed to get audio URL:', error);
      }
    }
    return '';
  }, [proxyFile, audioFile]);

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
