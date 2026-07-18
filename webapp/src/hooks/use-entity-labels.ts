import { useQuery } from '@tanstack/react-query';
import type { ListResult } from 'pocketbase';
import { LabelType } from '@project/shared';
import {
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

/**
 * One page of the labels of one type attributed to an entity (directly via
 * their track, or via their provider cluster), ordered by media and start.
 * A request past the last page (e.g. after an unlink emptied it) falls back
 * to the real last page inside the fetch; `page` in the result is the
 * effective page actually served.
 */
export function useEntityLabels(
  entityId: string,
  labelType: LabelType,
  page: number,
  perPage: number
) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: qk.entities.labels(entityId, labelType, page, perPage),
    enabled: !!entityId && isAuthenticated,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const fetchPage = (p: number) =>
        labelMutatorFor(labelType).getList(
          p,
          perPage,
          labelAttributionFilter(labelType, entityId),
          'MediaRef,start',
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
