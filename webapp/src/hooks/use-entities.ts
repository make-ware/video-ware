import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  EntityMutator,
  EntityStatsMutator,
  LabelEntityMutator,
  LabelSpeakerMutator,
  entityAttributionFilter,
} from '@project/shared/mutator';
import type {
  Entity,
  EntityPatch,
  LabelEntity,
  LabelSpeaker,
  LabelTrack,
  Media,
  Upload,
} from '@project/shared';
import { EntityKind } from '@project/shared';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/**
 * Every cache that renders an entity's identity or its links.
 *
 * An entity's NAME is read through expands on labels, speakers, tracks and
 * media tags, so a rename is as broad a change as a re-link — anything less
 * leaves stale names on other pages.
 */
function invalidateEntityViews(queryClient: QueryClient): void {
  const keys: readonly unknown[][] = [
    [...qk.entities.all],
    [...qk.labelTracks.all],
    ['labels'],
    // Speaker utterances expand LabelEntityRef for both the display name and
    // the linked entity, so a rename/re-link makes that cached expand stale.
    ['speakers'],
    [...qk.mediaEntities.all],
    [...qk.mediaTags.all],
  ];
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Operator-readable copy for an entity write failure.
 *
 * Entities carry UNIQUE (WorkspaceRef, kind, name), so a create or rename onto
 * an existing pair returns a PocketBase 400 whose per-field errors sit at
 * `response.data`. Left alone it surfaces as the opaque "Failed to create
 * record."
 */
export function entityWriteErrorMessage(
  error: unknown,
  fallback: string
): string {
  const data = (
    error as { response?: { data?: Record<string, { code?: string }> } }
  )?.response?.data;
  if (data?.name?.code === 'validation_not_unique') {
    return 'An entity with that name and kind already exists in this workspace.';
  }
  return error instanceof Error ? error.message : fallback;
}

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
      toast.error(entityWriteErrorMessage(error, 'Failed to create entity'));
    },
  });
}

/** Patch an entity's editable fields (name, aliases, description). */
export function useUpdateEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      entityId: string;
      patch: EntityPatch;
    }): Promise<Entity> =>
      new EntityMutator(pb).updateEntity(input.entityId, input.patch),
    onSuccess: (entity) => {
      toast.success(`Updated "${entity.name}"`);
      invalidateEntityViews(queryClient);
    },
    onError: (error) => {
      toast.error(entityWriteErrorMessage(error, 'Failed to update entity'));
    },
  });
}

/**
 * Delete an entity.
 *
 * PocketBase handles the fallout by relation config, so there is nothing to
 * clean up first: LabelEntity.EntityRef and LabelTrack.EntityRef are
 * `cascadeDelete: false`, so those references are cleared — the detected
 * labels survive and simply lose their attribution, which is what "delete
 * this identity" should mean. MediaTags.EntityRef is `cascadeDelete: true`,
 * so tag rows go with the entity (a tag without its entity is meaningless).
 */
export function useDeleteEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entityId: string): Promise<string> => {
      // BaseMutator.delete swallows every error (including 403) into `false`,
      // so a bare call would report success on failure.
      const deleted = await new EntityMutator(pb).delete(entityId);
      if (!deleted) throw new Error('Failed to delete entity');
      return entityId;
    },
    onSuccess: () => {
      toast.success('Entity deleted');
      invalidateEntityViews(queryClient);
    },
    onError: (error) => {
      toast.error(entityWriteErrorMessage(error, 'Failed to delete entity'));
    },
  });
}

/**
 * Link (or, with null, unlink) a label to an entity — the "this speaker /
 * this face / this object is Erik" operation.
 *
 * Writes LabelEntity, the single link point. It is per-media and
 * per-instance, so linking one media's "Speaker 1" says nothing about any
 * other media's. Invalidates every query that renders the link: entity views,
 * track lists, label inspectors, speaker transcripts.
 */
export function useAssignLabelEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      labelEntityId: string;
      entityId: string | null;
    }): Promise<LabelEntity> =>
      new LabelEntityMutator(pb).setEntity(input.labelEntityId, input.entityId),
    onSuccess: (_labelEntity, { entityId }) => {
      toast.success(entityId ? 'Linked to entity' : 'Entity link removed');
      invalidateEntityViews(queryClient);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update entity link'
      );
    },
  });
}

/**
 * Bulk variant of useAssignLabelEntity for the label inspectors'
 * multi-select: link (or, with null, unlink) many labels to one entity in a
 * single action. Partial failures are tolerated — successful links land and
 * the toast reports the failure count.
 */
export function useAssignLabelEntities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      labelEntityIds: string[];
      entityId: string | null;
    }): Promise<{ total: number; failed: number }> => {
      const mutator = new LabelEntityMutator(pb);
      const results = await Promise.allSettled(
        input.labelEntityIds.map((id) => mutator.setEntity(id, input.entityId))
      );
      return {
        total: results.length,
        failed: results.filter((r) => r.status === 'rejected').length,
      };
    },
    onSuccess: ({ total, failed }, { entityId }) => {
      const linked = total - failed;
      const noun = `label${linked === 1 ? '' : 's'}`;
      if (failed > 0) {
        toast.warning(
          `Updated ${linked} of ${total} labels — ${failed} failed`
        );
      } else {
        toast.success(
          entityId
            ? `Linked ${linked} ${noun} to entity`
            : `Removed entity link from ${linked} ${noun}`
        );
      }
      invalidateEntityViews(queryClient);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update entity links'
      );
    },
  });
}

export type EntitySpeakerRow = LabelSpeaker & {
  expand?: { MediaRef?: Media & { expand?: { UploadRef?: Upload } } };
};

/** Display name for a media row expanded with its upload. */
export function mediaDisplayName(
  media?: (Media & { expand?: { UploadRef?: Upload } }) | null
): string {
  if (!media) return '';
  return media.expand?.UploadRef?.name ?? media.label ?? media.id;
}

/** Rows grouped per media (by MediaRef), in first-row order. */
export function groupByMedia<
  T extends {
    MediaRef: string;
    expand?: { MediaRef?: Media & { expand?: { UploadRef?: Upload } } };
  },
>(rows: T[]): Array<{ mediaId: string; name: string; rows: T[] }> {
  const groups = new Map<string, { name: string; rows: T[] }>();
  for (const row of rows) {
    const group = groups.get(row.MediaRef);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(row.MediaRef, {
        name: mediaDisplayName(row.expand?.MediaRef) || row.MediaRef,
        rows: [row],
      });
    }
  }
  return [...groups.entries()].map(([mediaId, group]) => ({
    mediaId,
    ...group,
  }));
}

/** An entity card's representative track, with its media for the preview. */
export type EntityCardThumb = LabelTrack & { expand?: { MediaRef?: Media } };

/**
 * Thumbnail tracks for one page of entities in two requests: the EntityStats
 * view rows (whose thumbTrack picks each entity's representative track), then
 * those tracks with their media expanded (relation expand doesn't cross the
 * view). Keyed by the id set, so pages and kinds cache independently;
 * invalidated with the rest of qk.entities.
 */
export function useEntityCardThumbs(entityIds: string[]) {
  const { isAuthenticated } = useAuth();
  const idsKey = [...entityIds].sort().join(',');
  const query = useQuery({
    queryKey: qk.entities.cardThumbs(idsKey),
    enabled: entityIds.length > 0 && isAuthenticated,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const stats = await new EntityStatsMutator(pb).getByEntityIds(entityIds);
      const trackIds = stats
        .map((row) => row.thumbTrack)
        .filter((id): id is string => !!id);
      const tracks =
        trackIds.length === 0
          ? []
          : await pb.collection('LabelTrack').getFullList<EntityCardThumb>({
              filter: trackIds.map((id) => `id = "${id}"`).join(' || '),
              expand: 'MediaRef',
            });
      const trackById = new Map(tracks.map((track) => [track.id, track]));
      return Object.fromEntries(
        stats.map((row) => [
          row.id,
          (row.thumbTrack && trackById.get(row.thumbTrack)) || null,
        ])
      ) as Record<string, EntityCardThumb | null>;
    },
  });
  return { thumbsById: query.data, isLoading: query.isLoading };
}

/** Per-kind entity counts for the list page's tab badges. */
export function useEntityKindCounts(workspaceId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.kindCounts(workspaceId),
    enabled: !!workspaceId && isAuthenticated,
    queryFn: async () => {
      const mutator = new EntityMutator(pb);
      const kinds = Object.values(EntityKind);
      const results = await Promise.all(
        kinds.map((kind) => mutator.getByWorkspace(workspaceId, kind, 1, 1))
      );
      return Object.fromEntries(
        kinds.map((kind, i) => [kind, results[i].totalItems])
      ) as Record<EntityKind, number>;
    },
  });
  return { counts: query.data, isLoading: query.isLoading };
}

/**
 * Cross-media stats for one entity's header card: how many media it appears
 * in, via how many attributed tracks, and how many utterances it spoke.
 */
export function useEntityStats(entityId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.stats(entityId),
    enabled: !!entityId && isAuthenticated,
    queryFn: async () => {
      const [tracks, speakers] = await Promise.all([
        pb.collection('LabelTrack').getFullList({
          filter: entityAttributionFilter(entityId),
          fields: 'MediaRef',
        }),
        new LabelSpeakerMutator(pb).getList(
          1,
          1,
          entityAttributionFilter(entityId)
        ),
      ]);
      return {
        trackCount: tracks.length,
        mediaCount: new Set(tracks.map((t) => t.MediaRef)).size,
        utteranceCount: speakers.totalItems,
      };
    },
  });
  return {
    trackCount: query.data?.trackCount ?? 0,
    mediaCount: query.data?.mediaCount ?? 0,
    utteranceCount: query.data?.utteranceCount ?? 0,
    isLoading: query.isLoading,
  };
}
