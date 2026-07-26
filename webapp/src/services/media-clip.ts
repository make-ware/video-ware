import type { TypedPocketBase } from '@project/shared/types';
import { MediaClipMutator } from '@project/shared/mutator';
import type { ListResult } from 'pocketbase';
import type { ExpandedMediaClip } from '@/types/expanded-types';

/** The canonical clip list item shape served by `MediaClipService.listClips`. */
export type ClipListItem = ExpandedMediaClip;

/** Server-side filters for `MediaClipService.listClips`. */
export interface ClipListQuery {
  workspaceId: string;
  /**
   * null/undefined = every media in the workspace; id = only that media's
   * clips (the media viewer's Clips tab). Also narrows `search` — see below.
   */
  mediaId?: string | null;
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
 * The fields `search` matches, as a PocketBase filter expression.
 *
 * Media-scoped lists deliberately drop the three `MediaRef` fields: inside a
 * single media they are constant, so a term matching the filename would return
 * *every* clip instead of narrowing anything. `buildClipMatches` mirrors this
 * switch — if the two diverge, realtime merges disagree with the server.
 */
function searchExpr(mediaScoped: boolean): string {
  const clipFields = 'label ~ {:q} || description ~ {:q} || type ~ {:q}';
  return mediaScoped
    ? `(${clipFields})`
    : `(${clipFields} || MediaRef.label ~ {:q} || MediaRef.description ~ {:q} || MediaRef.UploadRef.name ~ {:q})`;
}

/**
 * The expands every clip card needs: `MediaRef` (+ its upload name and
 * preview assets) drives the sprite scrub and the filename subtitle. Kept as
 * one constant because the realtime subscription must request exactly the
 * same set — otherwise live-inserted records render differently from fetched
 * ones.
 *
 * Media-scoped lists repeat the same media once per row, which is redundant,
 * but keeping a single expand set is what keeps the fetch and the subscription
 * in lockstep — worth more than the saved bytes.
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

    if (query.mediaId) {
      clauses.push(
        this.pb.filter('MediaRef = {:media}', { media: query.mediaId })
      );
    }

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
      clauses.push(this.pb.filter(searchExpr(!!query.mediaId), { q: search }));
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

  /**
   * One clip by id, with the same expands as `listClips` so a detail record is
   * shape-identical to a list item. Resolves null when it doesn't exist
   * (`BaseMutator.getById` maps 404 to null and rethrows everything else).
   */
  async getClip(clipId: string): Promise<ClipListItem | null> {
    const record = await this.mediaClipMutator.getById(clipId, [
      ...CLIP_LIST_EXPAND,
    ]);
    return (record as ClipListItem | null) ?? null;
  }
}

export function createMediaClipService(pb: TypedPocketBase): MediaClipService {
  return new MediaClipService(pb);
}
