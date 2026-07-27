import { queryOptions, useQuery } from '@tanstack/react-query';
import { LabelSpeechMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/**
 * The whole media's speech transcript as one string.
 *
 * The transcripts page pages its segment list through `useLabelList`; this is
 * the deliberate exception — the Raw Text tab and the Copy button are
 * whole-media reads by definition, so they get their own query, fetched only
 * when one of them is actually used.
 *
 * Projected down to `transcript`: nothing here reads a record, only the joined
 * text, and LabelSpeech's per-word timings dominate the row otherwise.
 *
 * Exposed as shared options so the Copy button can pull the same cache entry
 * through `queryClient.fetchQuery` when the Raw Text tab was never opened.
 */
export function transcriptTextQueryOptions(mediaId: string) {
  return queryOptions({
    queryKey: qk.transcripts.text(mediaId),
    queryFn: async (): Promise<string> => {
      const mutator = new LabelSpeechMutator(pb, { fields: ['transcript'] });
      const items = await mutator.getAllByMedia(mediaId);
      return items
        .map((item) => item.transcript)
        .filter(Boolean)
        .join(' ');
    },
  });
}

/** Lazily-fetched full transcript text; `enabled` gates the whole-media read. */
export function useMediaTranscriptText(mediaId: string, enabled: boolean) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    ...transcriptTextQueryOptions(mediaId),
    enabled: enabled && !!mediaId && isAuthenticated,
  });
  return {
    text: query.data ?? '',
    isLoading: query.isFetching,
    error: query.error,
  };
}
