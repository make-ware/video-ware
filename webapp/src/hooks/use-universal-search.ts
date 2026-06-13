'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  SearchService,
  type SearchCategory,
  type SearchResult,
} from '@/services/search';

interface UseUniversalSearchReturn {
  results: SearchResult[];
  total: number;
  isFetching: boolean;
  /** True once a non-empty query has been searched. */
  hasQuery: boolean;
}

/**
 * Debounced, paginated universal search for the timeline editor, scoped to the
 * current workspace. Re-keyed per category/page so each combination caches
 * independently. `page` is 0-based.
 */
export function useUniversalSearch(
  category: SearchCategory,
  query: string,
  page: number,
  perPage: number
): UseUniversalSearchReturn {
  const { currentWorkspace } = useWorkspace();
  const service = useMemo(() => new SearchService(pb), []);

  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const workspaceId = currentWorkspace?.id ?? '';

  const result = useQuery({
    queryKey: qk.search.results(category, workspaceId, debounced, page, perPage),
    enabled: !!workspaceId && debounced.length > 0,
    // Keep prior results visible while the next query resolves (no flicker).
    placeholderData: (prev) => prev,
    queryFn: () =>
      service.search(category, workspaceId, debounced, page, perPage),
  });

  return {
    results: result.data?.results ?? [],
    total: result.data?.total ?? 0,
    isFetching: result.isFetching,
    hasQuery: debounced.length > 0,
  };
}
