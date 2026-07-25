import type { TypedPocketBase } from '@project/shared/types';
import { MediaClipMutator } from '@project/shared/mutator';
import type { ListResult } from 'pocketbase';
import type { ExpandedMediaClip } from '@/types/expanded-types';

/** The canonical clip list item shape served by `MediaClipService.listClips`. */
export type ClipListItem = ExpandedMediaClip;

/** Server-side filters for `MediaClipService.listClips`. */
export interface ClipListQuery {
  workspaceId: string;
  /** null/undefined = all directories; '' = workspace root; id = directory. */
  directoryId?: string | null;
  /** 'all'/undefined = every clip type; otherwise a concrete ClipType. */
  clipType?: string;
  /** 'all'/undefined = every media type (filtered through MediaRef). */
  mediaType?: string;
  /** Matched against the clip's and its source media's text fields. */
  search?: string;
}

/**
 * The expands every clip card needs: `MediaRef` (+ its upload name and
 * preview assets) drives the sprite scrub and the filename subtitle. Kept as
 * one constant because the realtime subscription must request exactly the
 * same set — otherwise live-inserted records render differently from fetched
 * ones.
 */
export const CLIP_LIST_EXPAND: readonly string[] = [
  'MediaRef',
  'MediaRef.UploadRef',
  'MediaRef.thumbnailFileRef',
  'MediaRef.spriteFileRef',
  'MediaRef.filmstripFileRefs',
];

/**
 * Media clip service: workspace-scoped clip listing with the pagination
 * envelope preserved and every filter pushed server-side, so the timeline
 * library can page through a large workspace instead of sorting a truncated
 * first page.
 *
 * Deliberately bypasses `MediaClipMutator.getByWorkspace`, which interpolates
 * its search term straight into the filter string and hard-codes `-created`.
 */
export class MediaClipService {
  private pb: TypedPocketBase;
  private mediaClipMutator: MediaClipMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.mediaClipMutator = new MediaClipMutator(pb);
  }

  /**
   * List clips with server-side filters and sort. User input is bound via
   * pb.filter — never interpolated into the filter string.
   */
  async listClips(
    query: ClipListQuery,
    page = 1,
    perPage = 24,
    sort = '-created'
  ): Promise<ListResult<ClipListItem>> {
    const clauses = [
      this.pb.filter('WorkspaceRef = {:ws}', { ws: query.workspaceId }),
    ];

    // '' is meaningful (workspace root), so only null/undefined means "all".
    if (query.directoryId !== null && query.directoryId !== undefined) {
      clauses.push(
        this.pb.filter('MediaRef.DirectoryRef = {:dir}', {
          dir: query.directoryId,
        })
      );
    }

    if (query.clipType && query.clipType !== 'all') {
      clauses.push(this.pb.filter('type = {:type}', { type: query.clipType }));
    }

    if (query.mediaType && query.mediaType !== 'all') {
      clauses.push(
        this.pb.filter('MediaRef.mediaType = {:mtype}', {
          mtype: query.mediaType,
        })
      );
    }

    const search = query.search?.trim();
    if (search) {
      clauses.push(
        this.pb.filter(
          '(label ~ {:q} || description ~ {:q} || type ~ {:q} || MediaRef.label ~ {:q} || MediaRef.description ~ {:q} || MediaRef.UploadRef.name ~ {:q})',
          { q: search }
        )
      );
    }

    const result = await this.mediaClipMutator.getList(
      page,
      perPage,
      clauses,
      sort,
      [...CLIP_LIST_EXPAND]
    );

    // MediaClipMutator is declared without a Relations map, so its expand type
    // is untyped — narrow it to the shape the cards read.
    return { ...result, items: result.items as ClipListItem[] };
  }
}

export function createMediaClipService(pb: TypedPocketBase): MediaClipService {
  return new MediaClipService(pb);
}
