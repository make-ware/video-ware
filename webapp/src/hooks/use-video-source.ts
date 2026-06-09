import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Media,
  MediaRelations,
  Expanded,
  MediaClip,
  File,
} from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';

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
  const proxyFromExpand =
    media && 'expand' in media && media.expand && 'proxyFileRef' in media.expand
      ? (media.expand.proxyFileRef as File | undefined)
      : undefined;
  const thumbnailFromExpand =
    media &&
    'expand' in media &&
    media.expand &&
    'thumbnailFileRef' in media.expand
      ? (media.expand.thumbnailFileRef as File | undefined)
      : undefined;
  const audioFromExpand =
    media && 'expand' in media && media.expand && 'audioFileRef' in media.expand
      ? (media.expand.audioFileRef as File | undefined)
      : undefined;

  const proxyRef = media?.proxyFileRef;
  const thumbnailRef = media?.thumbnailFileRef;
  const audioRef = media?.audioFileRef;

  // Only fetch the files we don't already have via expand.
  const needsProxy = !proxyFromExpand && !!proxyRef;
  const needsThumbnail = !thumbnailFromExpand && !!thumbnailRef;
  const needsAudio = !audioFromExpand && !!audioRef;
  const needsFetch = needsProxy || needsThumbnail || needsAudio;

  const query = useQuery({
    queryKey: qk.videoSource(media?.id ?? ''),
    enabled: !!media && needsFetch,
    queryFn: async () => {
      const [proxy, thumbnail, audio] = await Promise.all([
        needsProxy
          ? pb.collection('Files').getOne<File>(proxyRef!)
          : Promise.resolve(null),
        needsThumbnail
          ? pb.collection('Files').getOne<File>(thumbnailRef!)
          : Promise.resolve(null),
        needsAudio
          ? pb.collection('Files').getOne<File>(audioRef!)
          : Promise.resolve(null),
      ]);
      return { proxy, thumbnail, audio };
    },
  });

  const proxyFile = proxyFromExpand ?? query.data?.proxy ?? null;
  const thumbnailFile = thumbnailFromExpand ?? query.data?.thumbnail ?? null;
  const audioFile = audioFromExpand ?? query.data?.audio ?? null;

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

  return {
    src,
    poster,
    startTime: clip?.start ?? 0,
    endTime: clip?.end,
    isLoading: query.isLoading,
  };
}
