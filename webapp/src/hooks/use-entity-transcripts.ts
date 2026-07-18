import { useQuery } from '@tanstack/react-query';
import {
  LabelSpeakerMutator,
  entityAttributionFilter,
} from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';
import type { EntitySpeakerRow } from './use-entities';

/**
 * One page of everything an entity said across media (diarized speaker
 * utterances), optionally narrowed by a server-side transcript search.
 */
export function useEntityTranscripts(
  entityId: string,
  search: string,
  page: number,
  perPage: number
) {
  const { isAuthenticated } = useAuth();
  const trimmed = search.trim();
  const query = useQuery({
    queryKey: qk.entities.transcripts(entityId, trimmed, page, perPage),
    enabled: !!entityId && isAuthenticated,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // The entity id is a resolved record id (safe to embed — the shared
      // attribution filters are string templates); the user's query is
      // always bound via pb.filter.
      const parts = [entityAttributionFilter(entityId)];
      if (trimmed) {
        parts.push(pb.filter('transcript ~ {:q}', { q: trimmed }));
      }
      const fetchPage = (p: number) =>
        new LabelSpeakerMutator(pb).getList(
          p,
          perPage,
          parts.join(' && '),
          'MediaRef,start',
          ['MediaRef.UploadRef']
        );
      // A request past the last page (e.g. a narrower search) falls back to
      // the real last page; `page` in the result is the effective page.
      let result = await fetchPage(page);
      if (
        result.items.length === 0 &&
        result.totalPages > 0 &&
        page > result.totalPages
      ) {
        result = await fetchPage(result.totalPages);
      }
      return {
        ...result,
        items: result.items as EntitySpeakerRow[],
      };
    },
  });
  return {
    utterances: query.data?.items ?? [],
    page: query.data?.page ?? page,
    totalPages: query.data?.totalPages ?? 0,
    totalItems: query.data?.totalItems ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
