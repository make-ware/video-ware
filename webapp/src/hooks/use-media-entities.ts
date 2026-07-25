import { useQuery } from '@tanstack/react-query';
import { MediaEntitiesMutator } from '@project/shared/mutator';
import type { MediaEntityLink } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';

/** Entity links per media id, as consumed by the gallery's cards. */
export type MediaEntityLinksById = Record<string, MediaEntityLink[]>;

/**
 * Entity links for one page of media in a single request, via the
 * `MediaEntities` view (curator tags + label attribution merged in SQL).
 * Keyed by the id set, so scrolling to a new page caches independently.
 *
 * The view emits no realtime events, so remote tag changes land on the next
 * invalidation (`qk.mediaEntities.all`) rather than over SSE.
 */
export function useMediaEntityLinks(mediaIds: string[]) {
  const { isAuthenticated } = useAuth();
  const idsKey = [...mediaIds].sort().join(',');
  const query = useQuery({
    queryKey: qk.mediaEntities.byMediaIds(idsKey),
    enabled: mediaIds.length > 0 && isAuthenticated,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<MediaEntityLinksById> => {
      const rows = await new MediaEntitiesMutator(pb).getByMediaIds(mediaIds);
      return Object.fromEntries(rows.map((row) => [row.id, row.entities]));
    },
  });
  return { linksByMediaId: query.data, isLoading: query.isLoading };
}
