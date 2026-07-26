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
      // The media list's card chips come from the MediaEntities view, which
      // emits no realtime events — refresh them explicitly.
      void queryClient.invalidateQueries({ queryKey: qk.mediaEntities.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to tag media'
      );
    },
  });
}

/** Outcome of a bulk tag/untag: partial failures are tolerated, not fatal. */
export interface BulkTagResult {
  total: number;
  failed: number;
}

async function settleTagWrites(
  writes: Array<Promise<unknown>>
): Promise<BulkTagResult> {
  const results = await Promise.allSettled(writes);
  return {
    total: results.length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}

/**
 * Tag many media with one entity — the media list's multi-select action.
 * `tag()` is idempotent, so already-tagged media are a no-op rather than a
 * duplicate or an error.
 */
export function useTagMediaBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      mediaIds: string[];
      entityId: string;
    }): Promise<BulkTagResult> => {
      const mutator = new MediaTagMutator(pb);
      return settleTagWrites(
        input.mediaIds.map((mediaId) =>
          mutator.tag({
            WorkspaceRef: input.workspaceId,
            MediaRef: mediaId,
            EntityRef: input.entityId,
          })
        )
      );
    },
    onSuccess: ({ total, failed }) => {
      const tagged = total - failed;
      if (failed > 0) {
        toast.warning(`Tagged ${tagged} of ${total} — ${failed} failed`);
      } else {
        toast.success(`Tagged ${tagged} ${tagged === 1 ? 'item' : 'items'}`);
      }
      void queryClient.invalidateQueries({ queryKey: qk.mediaTags.all });
      void queryClient.invalidateQueries({ queryKey: qk.mediaEntities.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to tag media'
      );
    },
  });
}

/**
 * Remove one entity tag from many media. Media without the tag are quiet
 * no-ops, so this is safe over a mixed selection.
 */
export function useUntagMediaBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      mediaIds: string[];
      entityId: string;
    }): Promise<BulkTagResult> => {
      const mutator = new MediaTagMutator(pb);
      return settleTagWrites(
        input.mediaIds.map((mediaId) => mutator.untag(mediaId, input.entityId))
      );
    },
    onSuccess: ({ total, failed }) => {
      const removed = total - failed;
      if (failed > 0) {
        toast.warning(
          `Removed the tag from ${removed} of ${total} — ${failed} failed`
        );
      } else {
        toast.success(
          `Removed the tag from ${removed} ${removed === 1 ? 'item' : 'items'}`
        );
      }
      void queryClient.invalidateQueries({ queryKey: qk.mediaTags.all });
      void queryClient.invalidateQueries({ queryKey: qk.mediaEntities.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to remove tags'
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
      // The media list's card chips come from the MediaEntities view, which
      // emits no realtime events — refresh them explicitly.
      void queryClient.invalidateQueries({ queryKey: qk.mediaEntities.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to remove tag'
      );
    },
  });
}
