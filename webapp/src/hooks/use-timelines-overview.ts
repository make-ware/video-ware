'use client';

import { useQuery } from '@tanstack/react-query';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import type { File, Timeline, TimelineRender } from '@project/shared';

const MAX_RENDERS_PER_TIMELINE = 3;

// PocketBase back-relation expand: `<referencingCollection>_via_<field>`.
// TimelineRenders.TimelineRef points at Timelines, so this pulls every render
// for each timeline (with its output File nested) in a single request.
const RENDER_EXPAND_KEY = 'TimelineRenders_via_TimelineRef' as const;

/** A render row with its output file resolved (as the card renders it). */
export type OverviewRender = TimelineRender & {
  expand?: { FileRef?: File };
};

/** One timeline paired with its most-recent renders. */
export interface TimelineOverviewItem {
  timeline: Timeline;
  renders: OverviewRender[];
}

/** One page of overview items plus PocketBase pagination metadata. */
export interface TimelinesOverviewPage {
  items: TimelineOverviewItem[];
  page: number;
  totalPages: number;
  totalItems: number;
}

type TimelineWithRenders = Timeline & {
  expand?: {
    TimelineRenders_via_TimelineRef?: OverviewRender[];
  };
};

/**
 * Fetches one page of a workspace's timelines (newest-updated first) together
 * with each timeline's recent renders, cached/memoized by TanStack Query.
 * Renders are pulled as an expanded edge (no second request) and trimmed to
 * the newest few per timeline.
 */
export function useTimelinesOverview(
  workspaceId: string | undefined,
  page: number,
  perPage: number
) {
  const query = useQuery({
    queryKey: qk.timelines.overview(workspaceId ?? '', page, perPage),
    enabled: !!workspaceId,
    // Keep showing the previous page's data while the next page loads so
    // pagination doesn't flash the skeleton state.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<TimelinesOverviewPage> => {
      // enabled guarantees workspaceId is defined once the query runs.
      if (!workspaceId) {
        return { items: [], page: 1, totalPages: 0, totalItems: 0 };
      }

      const result = await pb
        .collection('Timelines')
        .getList<TimelineWithRenders>(page, perPage, {
          filter: `WorkspaceRef = "${workspaceId}"`,
          sort: '-updated',
          expand: `${RENDER_EXPAND_KEY}.FileRef`,
        });

      const items = result.items.map((timeline) => {
        // Back-relation expands come back unordered, so sort newest-first here
        // and keep only the few most-recent renders for the overview.
        const renders = [...(timeline.expand?.[RENDER_EXPAND_KEY] ?? [])]
          .sort((a, b) =>
            a.created < b.created ? 1 : a.created > b.created ? -1 : 0
          )
          .slice(0, MAX_RENDERS_PER_TIMELINE);
        return { timeline, renders };
      });

      return {
        items,
        page: result.page,
        totalPages: result.totalPages,
        totalItems: result.totalItems,
      };
    },
  });

  return {
    items: query.data?.items ?? [],
    totalPages: query.data?.totalPages ?? 0,
    totalItems: query.data?.totalItems ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : 'Failed to load timelines'
      : null,
    reload: () => query.refetch(),
  };
}
