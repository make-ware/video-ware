import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EntityMutator,
  EntityStatsMutator,
  LabelSpeakerMutator,
  LabelTrackMutator,
  entityAttributionFilter,
  trackEntityAttributionFilter,
} from '@project/shared/mutator';
import type {
  Entity,
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
        toast.warning(
          `Updated ${linked} of ${total} tracks — ${failed} failed`
        );
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

/**
 * One page of a workspace's entities of one kind, optionally searched.
 * A request past the last page (e.g. after deletes narrowed the set) falls
 * back to the real last page inside the fetch; `page` in the result is the
 * effective page actually served.
 */
export function useEntitiesByKind(
  workspaceId: string,
  kind: EntityKind,
  page: number,
  perPage: number,
  search: string
) {
  const { isAuthenticated } = useAuth();
  const trimmed = search.trim();
  const query = useQuery({
    queryKey: qk.entities.byKind(workspaceId, kind, page, perPage, trimmed),
    enabled: !!workspaceId && isAuthenticated,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const mutator = new EntityMutator(pb);
      const fetchPage = (p: number) =>
        trimmed
          ? mutator.search(workspaceId, trimmed, p, perPage, kind)
          : mutator.getByWorkspace(workspaceId, kind, p, perPage);
      let result = await fetchPage(page);
      if (
        result.items.length === 0 &&
        result.totalPages > 0 &&
        page > result.totalPages
      ) {
        result = await fetchPage(result.totalPages);
      }
      return result;
    },
  });
  return {
    entities: query.data?.items ?? [],
    page: query.data?.page ?? page,
    totalPages: query.data?.totalPages ?? 0,
    totalItems: query.data?.totalItems ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
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
          filter: trackEntityAttributionFilter(entityId),
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
