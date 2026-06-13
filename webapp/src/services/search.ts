import {
  MediaClipMutator,
  FileMutator,
  LabelObjectMutator,
  LabelSegmentMutator,
  LabelSpeechMutator,
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

/** MediaClip with the relations our search queries expand. */
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
 * Universal search for the timeline editor. Each category text-matches a
 * source table, then resolves matches to existing MediaClips so results are
 * always timeline-ready (no clips are created here).
 */
export class SearchService {
  private mediaClip: MediaClipMutator;
  private file: FileMutator;
  private labelObject: LabelObjectMutator;
  private labelSegment: LabelSegmentMutator;
  private labelSpeech: LabelSpeechMutator;

  constructor(pb: TypedPocketBase) {
    this.mediaClip = new MediaClipMutator(pb);
    this.file = new FileMutator(pb);
    this.labelObject = new LabelObjectMutator(pb);
    this.labelSegment = new LabelSegmentMutator(pb);
    this.labelSpeech = new LabelSpeechMutator(pb);
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
   * Objects/Transcripts/Tags: text-match the label table, then resolve the
   * matched labels to existing MediaClips via clipData.sourceId, preserving
   * the label confidence order.
   */
  private async searchLabels(
    category: Exclude<SearchCategory, 'metadata'>,
    workspaceId: string,
    query: string
  ): Promise<SearchResult[]> {
    // 1. Find matching labels (highest confidence first).
    const labels = await this.fetchLabels(category, workspaceId, query);
    if (labels.length === 0) return [];

    // snippet + score + relevance order, keyed by label id.
    const meta = new Map<
      string,
      { snippet: string; score: number; rank: number }
    >();
    labels.forEach((label, rank) => {
      meta.set(label.id, {
        snippet: this.snippetFor(category, label, query),
        score: label.score,
        rank,
      });
    });

    // 2. Resolve to existing MediaClips.
    const clipResult = await this.mediaClip.getBySourceLabels(
      workspaceId,
      labels.map((l) => l.id)
    );

    // 3. Keep only clips whose source label matched, order by label relevance.
    const results = (clipResult.items as SearchMediaClip[])
      .map((clip) => {
        const sourceId = clip.clipData?.sourceId;
        const m = sourceId ? meta.get(sourceId) : undefined;
        if (!m) return null;
        return {
          result: this.toResult(clip, category, m.snippet, m.score),
          rank: m.rank,
        };
      })
      .filter((x): x is { result: SearchResult; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_RESULTS)
      .map((x) => x.result);

    return results;
  }

  private async fetchLabels(
    category: Exclude<SearchCategory, 'metadata'>,
    workspaceId: string,
    query: string
  ): Promise<{ id: string; text: string; score: number }[]> {
    if (category === 'objects') {
      const r = await this.labelObject.searchByWorkspace(workspaceId, query);
      return r.items.map((l) => ({
        id: l.id,
        text: l.entity,
        score: l.confidence,
      }));
    }
    if (category === 'tags') {
      const r = await this.labelSegment.searchByWorkspace(workspaceId, query);
      return r.items.map((l) => ({
        id: l.id,
        text: l.entity,
        score: l.confidence,
      }));
    }
    // transcripts
    const r = await this.labelSpeech.searchByWorkspace(workspaceId, query);
    return r.items.map((l) => ({
      id: l.id,
      text: l.transcript,
      score: l.confidence,
    }));
  }

  private snippetFor(
    category: Exclude<SearchCategory, 'metadata'>,
    label: { text: string },
    query: string
  ): string {
    if (category === 'transcripts') {
      return excerpt(label.text, query, SNIPPET_LEN);
    }
    return label.text;
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
