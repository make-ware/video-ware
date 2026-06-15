import {
  MediaClipMutator,
  FileMutator,
  ClipLabelSearchMutator,
} from '@project/shared/mutator';
import type { File, Media, MediaClip, Upload } from '@project/shared';
import type { TypedPocketBase } from '@project/shared/types';

export type SearchCategory = 'metadata' | 'objects' | 'transcripts' | 'tags';

export const SEARCH_CATEGORIES: { id: SearchCategory; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'objects', label: 'Objects' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'tags', label: 'Tags' },
];

/** Expanded media carried on a result so the row can render a sprite preview. */
export type SearchResultMedia = Media & {
  expand?: {
    UploadRef?: Upload;
    thumbnailFileRef?: File;
    spriteFileRef?: File;
  };
};

/** A single, normalized search hit that maps to an existing MediaClip. */
export interface SearchResult {
  key: string; // stable React key, `${category}:${clipId}`
  clipId: string; // MediaClip id (passed to addClip as mediaClipId)
  mediaId: string; // clip.MediaRef
  mediaName: string;
  thumbnailUrl?: string;
  /** Expanded source media (for the sprite-viewer preview). */
  media?: SearchResultMedia;
  start: number; // seconds (in source media)
  end: number; // seconds
  snippet?: string; // entity name / transcript excerpt
  category: SearchCategory;
  score: number; // label confidence 0..1; 1 for metadata
}

/** A page of results plus the total count for pagination. */
export interface SearchPage {
  results: SearchResult[];
  total: number;
}

/** MediaClip with the relations our hydration query expands. */
type SearchMediaClip = MediaClip & {
  expand?: { MediaRef?: SearchResultMedia };
};

const SNIPPET_LEN = 120;
// Upper bound of view rows scanned per (category, query) before dedupe. Bounds
// the total distinct clips a label search can page through.
const VIEW_ROW_CAP = 200;

const EMPTY_PAGE: SearchPage = { results: [], total: 0 };

/**
 * Universal search for the timeline editor.
 *
 * - Objects / Tags / Transcripts: query the `ClipLabelSearch` view (a temporal
 *   join of MediaClips to labels on MediaRef + time overlap), dedupe to the
 *   best matching label per clip, then hydrate the requested page of clips.
 * - Metadata: match clips by their media's upload filename (server-paginated).
 *
 * Returns only existing clips; no clips are created here.
 */
export class SearchService {
  private mediaClip: MediaClipMutator;
  private file: FileMutator;
  private clipLabelSearch: ClipLabelSearchMutator;

  constructor(pb: TypedPocketBase) {
    this.mediaClip = new MediaClipMutator(pb);
    this.file = new FileMutator(pb);
    this.clipLabelSearch = new ClipLabelSearchMutator(pb);
  }

  /** `page` is 0-based. */
  async search(
    category: SearchCategory,
    workspaceId: string,
    query: string,
    page = 0,
    perPage = 5
  ): Promise<SearchPage> {
    const q = query.trim();
    if (!q) return EMPTY_PAGE;

    if (category === 'metadata') {
      return this.searchMetadata(workspaceId, q, page, perPage);
    }
    return this.searchLabels(category, workspaceId, q, page, perPage);
  }

  /** Metadata: match clips by their media's upload filename. */
  private async searchMetadata(
    workspaceId: string,
    query: string,
    page: number,
    perPage: number
  ): Promise<SearchPage> {
    const result = await this.mediaClip.searchByMediaName(
      workspaceId,
      query,
      page + 1,
      perPage
    );
    return {
      results: (result.items as SearchMediaClip[]).map((clip) =>
        this.toResult(clip, 'metadata', undefined, 1)
      ),
      total: result.totalItems,
    };
  }

  /**
   * Objects/Transcripts/Tags: query the temporal-join view, dedupe to the best
   * matching label per clip, then hydrate the requested page for display.
   */
  private async searchLabels(
    category: Exclude<SearchCategory, 'metadata'>,
    workspaceId: string,
    query: string,
    page: number,
    perPage: number
  ): Promise<SearchPage> {
    const view = await this.clipLabelSearch.searchByWorkspace(
      category,
      workspaceId,
      query,
      VIEW_ROW_CAP
    );
    if (view.items.length === 0) return EMPTY_PAGE;

    // Rows are sorted by confidence desc; the first row per clip is its best
    // match. Insertion order therefore ranks clips by best-match confidence.
    const order: string[] = [];
    const best = new Map<string, { matchText: string; score: number }>();
    for (const row of view.items) {
      if (!best.has(row.clipId)) {
        best.set(row.clipId, {
          matchText: row.matchText,
          score: row.confidence,
        });
        order.push(row.clipId);
      }
    }

    const total = order.length;
    const pageIds = order.slice(page * perPage, page * perPage + perPage);
    if (pageIds.length === 0) return { results: [], total };

    // Hydrate clip/media/thumbnail through the real collection (working expand).
    const clips = await this.mediaClip.getByIds(pageIds);
    const clipById = new Map(
      (clips.items as SearchMediaClip[]).map((c) => [c.id, c])
    );

    const results: SearchResult[] = [];
    for (const clipId of pageIds) {
      const clip = clipById.get(clipId);
      const match = best.get(clipId);
      if (!clip || !match) continue;
      const snippet =
        category === 'transcripts'
          ? excerpt(match.matchText, query, SNIPPET_LEN)
          : match.matchText;
      results.push(this.toResult(clip, category, snippet, match.score));
    }
    return { results, total };
  }

  private toResult(
    clip: SearchMediaClip,
    category: SearchCategory,
    snippet: string | undefined,
    score: number
  ): SearchResult {
    const media = clip.expand?.MediaRef;
    const thumb = media?.expand?.thumbnailFileRef;
    return {
      key: `${category}:${clip.id}`,
      clipId: clip.id,
      mediaId: clip.MediaRef,
      mediaName: media?.expand?.UploadRef?.name ?? 'Untitled',
      // pb.files.getURL needs the stored filename (the value of the File
      // record's `file` field), not the field name — matches MediaCard etc.
      thumbnailUrl: thumb?.file
        ? this.file.getFileUrl(thumb, thumb.file)
        : undefined,
      media,
      start: clip.start,
      end: clip.end,
      snippet,
      category,
      score,
    };
  }
}

/**
 * Build a ~maxLen excerpt of `text` centered on the first match of `query`,
 * with ellipses where it was trimmed.
 */
function excerpt(text: string, query: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, maxLen).trimEnd() + '…';

  const half = Math.floor((maxLen - query.length) / 2);
  let start = Math.max(0, idx - half);
  const end = Math.min(text.length, start + maxLen);
  start = Math.max(0, end - maxLen);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end).trim() + suffix;
}
