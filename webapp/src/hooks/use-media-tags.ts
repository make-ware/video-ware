import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MediaTagMutator } from '@project/shared/mutator';
import type { Entity, Media, MediaTag, Upload } from '@project/shared';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/** A tag row with its entity expanded, as fetched by useMediaTags. */
export type MediaTagWithEntity = MediaTag & {
  expand?: { EntityRef?: Entity };
};

/** A tag row with its media (and upload name) expanded. */
export type MediaTagWithMedia = MediaTag & {
  expand?: { MediaRef?: Media & { expand?: { UploadRef?: Upload } } };
};

/** A media's whole-media entity tags ("this media features X"). */
export function useMediaTags(mediaId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.mediaTags.byMedia(mediaId),
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const result = await new MediaTagMutator(pb).getByMedia(
        mediaId,
        1,
        100,
        'EntityRef'
      );
      return result.items as MediaTagWithEntity[];
    },
  });
  return {
    tags: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** All media tagged with an entity, newest tags first. */
export function useEntityTaggedMedia(entityId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.mediaTags.byEntity(entityId),
    enabled: !!entityId && isAuthenticated,
    queryFn: async () => {
      const result = await new MediaTagMutator(pb).getList(
        1,
        100,
        `EntityRef = "${entityId}"`,
        '-created',
        ['MediaRef.UploadRef']
      );
      return result.items as MediaTagWithMedia[];
    },
  });
  return {
    tags: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Tag a media with an entity. Idempotent at the mutator level (the unique
 * (MediaRef, EntityRef) index resolves races to the existing row).
 */
export function useTagMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      mediaId: string;
      entityId: string;
    }): Promise<MediaTag> =>
      new MediaTagMutator(pb).tag({
        WorkspaceRef: input.workspaceId,
        MediaRef: input.mediaId,
        EntityRef: input.entityId,
      }),
    onSuccess: (_tag, { mediaId, entityId }) => {
      toast.success('Tagged media');
      void queryClient.invalidateQueries({
        queryKey: qk.mediaTags.byMedia(mediaId),
      });
      void queryClient.invalidateQueries({
        queryKey: qk.mediaTags.byEntity(entityId),
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to tag media'
      );
    },
  });
}

/** Remove a (media, entity) tag; a missing tag is a quiet no-op. */
export function useUntagMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      mediaId: string;
      entityId: string;
    }): Promise<boolean> =>
      new MediaTagMutator(pb).untag(input.mediaId, input.entityId),
    onSuccess: (_removed, { mediaId, entityId }) => {
      toast.success('Tag removed');
      void queryClient.invalidateQueries({
        queryKey: qk.mediaTags.byMedia(mediaId),
      });
      void queryClient.invalidateQueries({
        queryKey: qk.mediaTags.byEntity(entityId),
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to remove tag'
      );
    },
  });
}
