/**
 * Centralized TanStack Query key factory.
 *
 * Keys are hierarchical arrays so partial-prefix invalidation works
 * (e.g. invalidating `['media']` refreshes every media query). TanStack
 * compares keys by value (structural equality), so passing a fresh literal
 * every render is correct by design — include every input that changes the
 * result set in the key (debounced search, filters, sort).
 */
export const qk = {
  media: {
    all: ['media'] as const,
    detail: (id: string) => ['media', 'detail', id] as const,
  },
  clips: {
    library: (args: {
      kind: string;
      workspaceId: string;
      directoryId?: string;
      typeFilter: string;
      mediaTypeFilter: string;
      sortBy: string;
      search: string;
    }) => ['clips', 'library', args] as const,
  },
  directories: {
    children: (workspaceId: string, parentId: string | null) =>
      ['directories', workspaceId, parentId] as const,
    detail: (id: string) => ['directories', 'detail', id] as const,
  },
  timelines: {
    all: ['timelines'] as const,
    overview: (workspaceId: string, page: number, perPage: number) =>
      ['timelines', 'overview', workspaceId, page, perPage] as const,
  },
  transcripts: {
    byMedia: (id: string) => ['transcripts', id] as const,
  },
  labels: {
    list: (
      mediaId: string,
      labelType: string,
      filters: { minConfidence: number; minDuration: number; query: string }
    ) => ['labels', 'list', mediaId, labelType, filters] as const,
  },
  search: {
    results: (
      category: string,
      workspaceId: string,
      query: string,
      page: number,
      perPage: number
    ) => ['search', category, workspaceId, query, page, perPage] as const,
  },
  files: {
    sprite: (id: string) => ['files', 'sprite', id] as const,
    filmstrip: (mediaId: string) => ['files', 'filmstrip', mediaId] as const,
  },
  videoSource: (
    mediaId: string,
    refs?: { proxyRef?: string; thumbnailRef?: string; audioRef?: string }
  ) =>
    [
      'video-source',
      mediaId,
      refs?.proxyRef ?? '',
      refs?.thumbnailRef ?? '',
      refs?.audioRef ?? '',
    ] as const,
} as const;
