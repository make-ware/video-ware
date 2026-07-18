import { useQuery } from '@tanstack/react-query';
import type PocketBase from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { LabelType } from '@project/shared';
import {
  LABEL_TYPE_META,
  LabelFaceMutator,
  LabelObjectMutator,
  LabelPersonMutator,
  LabelSegmentMutator,
  LabelShotMutator,
  LabelSpeakerMutator,
  LabelSpeechMutator,
  LabelTextMutator,
  attributionExpands,
  labelAttributionFilter,
  type ActualizableLabel,
} from '@project/shared/mutator';
import type {
  Entity,
  LabelEntity,
  LabelTrack,
  Media,
  Upload,
} from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { mediaDisplayName } from './use-entities';
import { useAuth } from './use-auth';

/**
 * A leaf label row attributed to an entity, with the expands the entity
 * detail page renders from: the source media (named via its upload), the
 * row's track (for previews/unlink and the direct-vs-cluster distinction),
 * and its provider cluster.
 */
export type EntityLabelRow = ActualizableLabel & {
  expand?: {
    MediaRef?: Media & { expand?: { UploadRef?: Upload } };
    LabelTrackRef?: LabelTrack & { expand?: { EntityRef?: Entity } };
    LabelEntityRef?: LabelEntity & { expand?: { EntityRef?: Entity } };
  };
};

/** Minimal read surface common to all per-type label mutators. */
interface EntityLabelListMutator {
  getList(
    page?: number,
    perPage?: number,
    filter?: string | string[],
    sort?: string,
    expand?: string[]
  ): Promise<ListResult<EntityLabelRow>>;
}

/** The per-type mutator backing a label type's collection. */
function labelMutatorFor(type: LabelType): EntityLabelListMutator {
  switch (type) {
    case LabelType.OBJECT:
      return new LabelObjectMutator(pb);
    case LabelType.SHOT:
      return new LabelShotMutator(pb);
    case LabelType.PERSON:
      return new LabelPersonMutator(pb);
    case LabelType.SPEECH:
      return new LabelSpeechMutator(pb);
    case LabelType.SPEAKER:
      return new LabelSpeakerMutator(pb);
    case LabelType.FACE:
      return new LabelFaceMutator(pb);
    case LabelType.SEGMENT:
      return new LabelSegmentMutator(pb);
    case LabelType.TEXT:
      return new LabelTextMutator(pb);
  }
}

/**
 * How many labels of each type are attributed to an entity. Eight parallel
 * one-row queries (totalItems only); drives which type tabs render at all.
 */
export function useEntityLabelCounts(entityId: string) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.labelCounts(entityId),
    enabled: !!entityId && isAuthenticated,
    queryFn: async () => {
      const types = Object.values(LabelType);
      const results = await Promise.all(
        types.map((type) =>
          labelMutatorFor(type).getList(
            1,
            1,
            labelAttributionFilter(type, entityId)
          )
        )
      );
      return Object.fromEntries(
        types.map((type, i) => [type, results[i].totalItems])
      ) as Record<LabelType, number>;
    },
  });
  return { counts: query.data, isLoading: query.isLoading };
}

/** One media an entity's labels of one type appear in, with the row count. */
export interface EntityLabelMediaGroup {
  mediaId: string;
  name: string;
  count: number;
}

/**
 * The media an entity's labels of one type are spread across, with per-media
 * counts (most labels first). Two bounded queries: a MediaRef-only sweep of
 * the label collection, then one Media fetch for display names.
 */
export function useEntityLabelMedia(entityId: string, labelType: LabelType) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.labelMedia(entityId, labelType),
    enabled: !!entityId && isAuthenticated,
    queryFn: async (): Promise<EntityLabelMediaGroup[]> => {
      // The typed collection() only accepts literal names; the base client
      // signature takes the dynamic one.
      const basePb: PocketBase = pb;
      const rows = await basePb
        .collection(LABEL_TYPE_META[labelType].collection)
        .getFullList<{ MediaRef: string }>({
          filter: labelAttributionFilter(labelType, entityId),
          fields: 'MediaRef',
        });
      const countByMedia = new Map<string, number>();
      for (const row of rows) {
        countByMedia.set(
          row.MediaRef,
          (countByMedia.get(row.MediaRef) ?? 0) + 1
        );
      }
      const mediaIds = [...countByMedia.keys()];
      if (mediaIds.length === 0) return [];

      const mediaRecords = await pb.collection('Media').getFullList({
        filter: mediaIds.map((id) => `id = "${id}"`).join(' || '),
        expand: 'UploadRef',
      });
      const nameById = new Map(
        mediaRecords.map((media) => [
          media.id,
          mediaDisplayName(
            media as Media & { expand?: { UploadRef?: Upload } }
          ),
        ])
      );
      return mediaIds
        .map((mediaId) => ({
          mediaId,
          name: nameById.get(mediaId) || mediaId,
          count: countByMedia.get(mediaId) ?? 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },
  });
  return {
    mediaGroups: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * One page of the labels of one type attributed to an entity within one
 * media, ordered by start. A request past the last page (e.g. after an
 * unlink emptied it) falls back to the real last page inside the fetch;
 * `page` in the result is the effective page actually served.
 */
export function useEntityLabels(
  entityId: string,
  labelType: LabelType,
  mediaId: string | null,
  page: number,
  perPage: number
) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.labels(
      entityId,
      labelType,
      mediaId ?? '',
      page,
      perPage
    ),
    enabled: !!entityId && !!mediaId && isAuthenticated,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const fetchPage = (p: number) =>
        labelMutatorFor(labelType).getList(
          p,
          perPage,
          [
            labelAttributionFilter(labelType, entityId),
            pb.filter('MediaRef = {:media}', { media: mediaId }),
          ],
          'start',
          ['MediaRef.UploadRef', ...attributionExpands(labelType)]
        );
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
    labels: query.data?.items ?? [],
    page: query.data?.page ?? page,
    totalPages: query.data?.totalPages ?? 0,
    totalItems: query.data?.totalItems ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
