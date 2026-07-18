'use client';

import { useQuery } from '@tanstack/react-query';
import { usePocketBase } from '@/contexts/pocketbase-context';
import { qk } from '@/lib/query-keys';
import type { LabelEntity, LabelTrack, Media } from '@project/shared';
import type { ActualizableLabel } from '@project/shared/mutator';
import type { ExpandedMedia } from '@/types/expanded-types';
import type { InspectorTypeConfig } from './config';

export type InspectorLabelRecord = ActualizableLabel & {
  expand?: {
    LabelTrackRef?: LabelTrack;
    LabelEntityRef?: LabelEntity;
    MediaRef?: Media | ExpandedMedia;
  };
};

/**
 * Entity attributed to a label row, mirroring the precedence encoded in
 * entityAttributionFilter: the track's manual link wins, the provider
 * cluster's link is the fallback. '' when unattributed.
 */
export function effectiveEntityId(record: InspectorLabelRecord): string {
  return (
    record.expand?.LabelTrackRef?.EntityRef ||
    record.expand?.LabelEntityRef?.EntityRef ||
    ''
  );
}

export interface LabelListFilters {
  minConfidence: number;
  minDuration: number;
  query: string;
}

const PAGE_SIZE = 200;

/**
 * Labels of one type for a media, filtered by confidence/duration and an
 * optional text query over the type's query fields. All user input is bound
 * via pb.filter (never interpolated into the filter string).
 */
export function useLabelList(
  config: InspectorTypeConfig,
  mediaId: string,
  filters: LabelListFilters
) {
  const { pb } = usePocketBase();

  return useQuery({
    queryKey: qk.labels.list(mediaId, config.labelType, filters),
    enabled: !!mediaId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const parts = ['MediaRef = {:media}'];
      const params: Record<string, unknown> = { media: mediaId };

      if (filters.minConfidence > 0) {
        parts.push(`${config.confidenceField} >= {:minConf}`);
        params.minConf = filters.minConfidence;
      }
      if (filters.minDuration > 0) {
        parts.push('duration >= {:minDur}');
        params.minDur = filters.minDuration;
      }
      const query = filters.query.trim();
      if (query && config.queryFields.length > 0) {
        parts.push(
          `(${config.queryFields.map((f) => `${f} ~ {:q}`).join(' || ')})`
        );
        params.q = query;
      }

      // LabelTrackRef is always expanded: the entity-link control reads the
      // track's EntityRef even for types whose preview doesn't animate it.
      // LabelEntityRef supplies the cluster-level entity fallback.
      const expand =
        'LabelTrackRef,LabelEntityRef,MediaRef,MediaRef.filmstripFileRefs';

      // TypedPocketBase's collection() overloads reject a union of names;
      // the explicit getList generic restores the record type.
      const result = await pb
        .collection(config.collection as 'LabelObjects')
        .getList<InspectorLabelRecord>(1, PAGE_SIZE, {
          filter: pb.filter(parts.join(' && '), params),
          sort: config.defaultSort,
          expand,
        });
      return result.items;
    },
  });
}
