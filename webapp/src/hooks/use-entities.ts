import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EntityMutator,
  LabelSpeakerMutator,
  LabelTrackMutator,
  entityAttributionFilter,
  trackEntityAttributionFilter,
} from '@project/shared/mutator';
import type {
  Entity,
  EntityKind,
  LabelEntity,
  LabelSpeaker,
  LabelTrack,
  Media,
  Upload,
} from '@project/shared';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/** A workspace's real-world entities (people, products, places, things). */
export function useWorkspaceEntities(workspaceId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.byWorkspace(workspaceId),
    enabled: !!workspaceId && isAuthenticated,
    queryFn: async () => {
      const result = await new EntityMutator(pb).getByWorkspace(
        workspaceId,
        undefined,
        1,
        500
      );
      return result.items;
    },
  });
  return {
    entities: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** One entity by id. */
export function useEntity(entityId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.detail(entityId),
    enabled: !!entityId && isAuthenticated,
    queryFn: () => new EntityMutator(pb).getById(entityId),
  });
  return {
    entity: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useCreateEntity(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      kind: EntityKind;
      description?: string;
    }): Promise<Entity> =>
      new EntityMutator(pb).create({ WorkspaceRef: workspaceId, ...input }),
    onSuccess: (entity) => {
      toast.success(`Created ${entity.kind} "${entity.name}"`);
      void queryClient.invalidateQueries({ queryKey: qk.entities.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create entity'
      );
    },
  });
}

/**
 * Link (or, with null, unlink) a label track to an entity — the per-media
 * "this face track / this speaker is Erik" operation. Invalidates every
 * query that renders the link: entity views, track lists, label inspectors.
 */
export function useAssignTrackEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      trackId: string;
      entityId: string | null;
    }): Promise<LabelTrack> =>
      new LabelTrackMutator(pb).setEntity(input.trackId, input.entityId),
    onSuccess: (_track, { entityId }) => {
      toast.success(entityId ? 'Linked to entity' : 'Entity link removed');
      void queryClient.invalidateQueries({ queryKey: qk.entities.all });
      void queryClient.invalidateQueries({ queryKey: ['label-tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['labels'] });
      // Speaker utterances expand LabelTrackRef.EntityRef for transcript
      // labels, so a re-link makes that cached expand stale.
      void queryClient.invalidateQueries({ queryKey: ['speakers'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update entity link'
      );
    },
  });
}

/**
 * Bulk variant of useAssignTrackEntity for the label inspectors'
 * multi-select: link (or, with null, unlink) many tracks to one entity in a
 * single action. Partial failures are tolerated — successful links land and
 * the toast reports the failure count.
 */
export function useAssignTracksEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      trackIds: string[];
      entityId: string | null;
    }): Promise<{ total: number; failed: number }> => {
      const mutator = new LabelTrackMutator(pb);
      const results = await Promise.allSettled(
        input.trackIds.map((trackId) =>
          mutator.setEntity(trackId, input.entityId)
        )
      );
      return {
        total: results.length,
        failed: results.filter((r) => r.status === 'rejected').length,
      };
    },
    onSuccess: ({ total, failed }, { entityId }) => {
      const linked = total - failed;
      const noun = `track${linked === 1 ? '' : 's'}`;
      if (failed > 0) {
        toast.warning(`Updated ${linked} of ${total} tracks — ${failed} failed`);
      } else {
        toast.success(
          entityId
            ? `Linked ${linked} ${noun} to entity`
            : `Removed entity link from ${linked} ${noun}`
        );
      }
      void queryClient.invalidateQueries({ queryKey: qk.entities.all });
      void queryClient.invalidateQueries({ queryKey: ['label-tracks'] });
      void queryClient.invalidateQueries({ queryKey: ['labels'] });
      void queryClient.invalidateQueries({ queryKey: ['speakers'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update entity links'
      );
    },
  });
}

/** A track attributed to an entity, with media + provider cluster expands. */
export type EntityTrack = LabelTrack & {
  expand?: {
    MediaRef?: Media & { expand?: { UploadRef?: Upload } };
    LabelEntityRef?: LabelEntity;
  };
};

/**
 * Where an entity appears across media: every LabelTrack attributed to it
 * (directly, or via its provider cluster), one appearance range each.
 */
export function useEntityAppearances(entityId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.appearances(entityId),
    enabled: !!entityId && isAuthenticated,
    queryFn: async () => {
      const result = await new LabelTrackMutator(pb).getList(
        1,
        500,
        trackEntityAttributionFilter(entityId),
        'MediaRef,start',
        ['MediaRef.UploadRef', 'LabelEntityRef']
      );
      return result.items as EntityTrack[];
    },
  });
  return {
    tracks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

export type EntitySpeakerRow = LabelSpeaker & {
  expand?: { MediaRef?: Media & { expand?: { UploadRef?: Upload } } };
};

/** Everything an entity said, across media (diarized speaker labels). */
export function useEntityWords(entityId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.words(entityId),
    enabled: !!entityId && isAuthenticated,
    queryFn: async () => {
      const result = await new LabelSpeakerMutator(pb).getList(
        1,
        500,
        entityAttributionFilter(entityId),
        'MediaRef,start',
        ['MediaRef.UploadRef']
      );
      return result.items as EntitySpeakerRow[];
    },
  });
  return {
    utterances: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** Display name for a media row expanded with its upload. */
export function mediaDisplayName(
  media?: (Media & { expand?: { UploadRef?: Upload } }) | null
): string {
  if (!media) return '';
  return media.expand?.UploadRef?.name ?? media.label ?? media.id;
}
