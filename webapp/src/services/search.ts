import {
  MediaClipMutator,
  FileMutator,
  ClipLabelSearchMutator,
} from '@project/shared/mutator';
import type { File, MediaClip } from '@project/shared';
import type { TypedPocketBase } from '@project/shared/types';

export type SearchCategory = 'metadata' | 'objects' | 'transcripts' | 'tags';

export const SEARCH_CATEGORIES: { id: SearchCategory; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'objects', label: 'Objects' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'tags', label: 'Tags' },
];

/** A single, normalized search hit that maps to an existing MediaClip. */
export interface SearchResult {
  key: string; // stable React key, `${category}:${clipId}`
  clipId: string; // MediaClip id (passed to addClip as mediaClipId)
  mediaId: string; // clip.MediaRef
  mediaName: string;
  thumbnailUrl?: string;
  start: number; // seconds (in source media)
  end: number; // seconds
  snippet?: string; // entity name / transcript excerpt
  category: SearchCategory;
  score: number; // label confidence 0..1; 1 for metadata
}

/** MediaClip with the relations our hydration query expands. */
type SearchMediaClip = MediaClip & {
  expand?: {
    MediaRef?: {
      id: string;
      expand?: {
        UploadRef?: { name?: string };
        thumbnailFileRef?: File;
      };
    };
  };
};

const MAX_RESULTS = 5;
const SNIPPET_LEN = 120;

/**
 * Universal search for the timeline editor.
 *
 * - Objects / Tags / Transcripts: query the `ClipLabelSearch` view (a temporal
 *   join of MediaClips to labels on MediaRef + time overlap), then hydrate the
 *   matched clip ids through the MediaClips collection. Returns only existing
 *   clips that overlap a matching label.
 * - Metadata: match clips by their media's upload filename.
 *
 * No clips are created here.
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

  async search(
    category: SearchCategory,
    workspaceId: string,
    query: string
  ): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    if (category === 'metadata') {
      return this.searchMetadata(workspaceId, q);
    }
    return this.searchLabels(category, workspaceId, q);
  }

  /** Metadata: match clips by their media's upload filename. */
  private async searchMetadata(
    workspaceId: string,
    query: string
  ): Promise<SearchResult[]> {
    const result = await this.mediaClip.searchByMediaName(
      workspaceId,
      query,
      MAX_RESULTS
    );
    return (result.items as SearchMediaClip[]).map((clip) =>
      this.toResult(clip, 'metadata', undefined, 1)
    );
  }

  /**
   * Objects/Transcripts/Tags: query the temporal-join view, dedupe to the best
   * matching label per clip, then hydrate the top clips for display.
   */
  private async searchLabels(
    category: Exclude<SearchCategory, 'metadata'>,
    workspaceId: string,
    query: string
  ): Promise<SearchResult[]> {
    const view = await this.clipLabelSearch.searchByWorkspace(
      category,
      workspaceId,
      query
    );
    if (view.items.length === 0) return [];

    // Rows are sorted by confidence desc; the first row per clip is its best
    // match. Map insertion order therefore ranks clips by best-match confidence.
    const bestByClip = new Map<string, { matchText: string; score: number }>();
    for (const row of view.items) {
      if (!bestByClip.has(row.clipId)) {
        bestByClip.set(row.clipId, {
          matchText: row.matchText,
          score: row.confidence,
        });
      }
    }

    const clipIds = [...bestByClip.keys()].slice(0, MAX_RESULTS);

    // Hydrate clip/media/thumbnail through the real collection (working expand).
    const clips = await this.mediaClip.getByIds(clipIds);
    const clipById = new Map(
      (clips.items as SearchMediaClip[]).map((c) => [c.id, c])
    );

    const results: SearchResult[] = [];
    for (const clipId of clipIds) {
      const clip = clipById.get(clipId);
      const match = bestByClip.get(clipId);
      if (!clip || !match) continue;
      const snippet =
        category === 'transcripts'
          ? excerpt(match.matchText, query, SNIPPET_LEN)
          : match.matchText;
      results.push(this.toResult(clip, category, snippet, match.score));
    }
    return results;
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
      thumbnailUrl: thumb ? this.file.getFileUrl(thumb) : undefined,
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
