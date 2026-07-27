'use client';

/**
 * One kind's entities as a non-realtime infinite list (see
 * use-infinite-list.ts).
 *
 * Deliberately not live: the entities page is a debug/admin surface whose
 * freshness comes from mutation invalidation, so it takes the plain TanStack
 * Query path rather than the SSE contract in use-live-infinite-list.ts.
 *
 * No sort descriptor — both mutator methods order by ENTITY_LIST_SORT, and
 * entities have a single natural order (name).
 */
import { useMemo } from 'react';
import type { Entity, EntityKind } from '@project/shared';
import { EntityMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useInfiniteList,
  type UseInfiniteListResult,
} from '@/hooks/use-infinite-list';

export const ENTITIES_PAGE_SIZE = 12;

export interface UseEntityListArgs {
  workspaceId: string;
  kind: EntityKind;
  /** Raw input; debounced 300ms internally. */
  searchQuery: string;
}

export function useEntityList(
  args: UseEntityListArgs
): UseInfiniteListResult<Entity> {
  const { workspaceId, kind, searchQuery } = args;
  const { isAuthenticated } = useAuth();
  const mutator = useMemo(() => new EntityMutator(pb), []);

  const search = useDebouncedValue(searchQuery).trim();

  return useInfiniteList<Entity>({
    queryKey: qk.entities.list({ workspaceId, kind, search }),
    enabled: !!workspaceId && isAuthenticated,
    fetchPage: (page) =>
      search
        ? mutator.search(workspaceId, search, page, ENTITIES_PAGE_SIZE, kind)
        : mutator.getByWorkspace(workspaceId, kind, page, ENTITIES_PAGE_SIZE),
  });
}
