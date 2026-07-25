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
    /** Prefix for every media list query — gap-heal / bulk-op invalidation. */
    lists: ['media', 'list'] as const,
    list: (args: {
      workspaceId: string;
      /** null = all directories, '' = workspace root, id = one directory. */
      directoryId: string | null;
      mediaType: string;
      sort: string;
      search: string;
    }) => ['media', 'list', args] as const,
    detail: (id: string) => ['media', 'detail', id] as const,
    neighbors: (workspaceId: string, mediaId: string) =>
      ['media', 'neighbors', workspaceId, mediaId] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    /** Prefix for every task list query — gap-heal / mutation invalidation. */
    lists: ['tasks', 'list'] as const,
    list: (args: {
      workspaceId: string;
      /** 'all' | 'active' | one TaskStatus. */
      status: string;
      /** 'all' | one TaskType. */
      type: string;
      sort: string;
      search: string;
    }) => ['tasks', 'list', args] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
  },
  clips: {
    all: ['clips'] as const,
    /** Prefix for every clip list query — gap-heal / mutation invalidation. */
    lists: ['clips', 'list'] as const,
    list: (args: {
      workspaceId: string;
      /** null = all directories, '' = workspace root, id = one directory. */
      directoryId: string | null;
      /** 'all' | one ClipType. */
      clipType: string;
      /** 'all' | 'video' | 'audio' | 'image'. */
      mediaType: string;
      sort: string;
      search: string;
    }) => ['clips', 'list', args] as const,
  },
  directories: {
    list: (workspaceId: string) => ['directories', workspaceId] as const,
    detail: (id: string) => ['directories', 'detail', id] as const,
  },
  timelines: {
    all: ['timelines'] as const,
    overview: (workspaceId: string, page: number, perPage: number) =>
      ['timelines', 'overview', workspaceId, page, perPage] as const,
    detail: (id: string) => ['timelines', 'detail', id] as const,
  },
  transcripts: {
    byMedia: (id: string) => ['transcripts', id] as const,
  },
  speakers: {
    byMedia: (id: string) => ['speakers', id] as const,
  },
  entities: {
    all: ['entities'] as const,
    byWorkspace: (workspaceId: string) =>
      ['entities', 'workspace', workspaceId] as const,
    detail: (id: string) => ['entities', 'detail', id] as const,
    byKind: (
      workspaceId: string,
      kind: string,
      page: number,
      perPage: number,
      search: string
    ) =>
      [
        'entities',
        'by-kind',
        workspaceId,
        kind,
        page,
        perPage,
        search,
      ] as const,
    kindCounts: (workspaceId: string) =>
      ['entities', 'kind-counts', workspaceId] as const,
    stats: (id: string) => ['entities', 'stats', id] as const,
    cardThumbs: (idsKey: string) =>
      ['entities', 'card-thumbs', idsKey] as const,
    labelCounts: (id: string) => ['entities', 'label-counts', id] as const,
    labelMedia: (id: string, labelType: string) =>
      ['entities', 'label-media', id, labelType] as const,
    labels: (
      id: string,
      labelType: string,
      mediaId: string,
      page: number,
      perPage: number
    ) => ['entities', 'labels', id, labelType, mediaId, page, perPage] as const,
    transcripts: (id: string, query: string, page: number, perPage: number) =>
      ['entities', 'transcripts', id, query, page, perPage] as const,
  },
  labelTracks: {
    byMedia: (id: string) => ['label-tracks', id] as const,
  },
  mediaTags: {
    all: ['media-tags'] as const,
    byMedia: (id: string) => ['media-tags', 'media', id] as const,
    byEntity: (id: string) => ['media-tags', 'entity', id] as const,
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
