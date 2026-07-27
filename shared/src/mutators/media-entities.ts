import { RecordService } from 'pocketbase';
import type { MediaEntities } from '../schema/media-entities-view';
import { mediaEntityLinksOf } from '../schema/media-entities-view';
import type { TypedPocketBase } from '../types';
import { BaseMutator } from './base';

/** Ids per list request — keeps the `id = ... || ...` filter proxy-safe. */
const MEDIA_IDS_PER_REQUEST = 100;

/**
 * Read-only mutator over the `MediaEntities` VIEW collection: the entities
 * attached to each media (curator tags + label attribution), merged in SQL.
 * Powers the media list page's per-card entity chips — one request per page of
 * cards instead of ~10 queries per media.
 */
export class MediaEntitiesMutator extends BaseMutator<MediaEntities, never> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection(): RecordService<MediaEntities> {
    return this.pb.collection('MediaEntities');
  }

  // The view is read-only; nothing is ever created through this mutator.
  protected async validateInput(input: never): Promise<never> {
    return input;
  }

  /**
   * Entity links for a set of media ids. Rows come back unordered relative to
   * `mediaIds`; callers key by id.
   *
   * Ids are chunked because the caller is an ever-growing load-more window: a
   * single `id = ... || ...` filter over hundreds of ids would outgrow the
   * query-string limits of proxies sitting in front of PocketBase.
   */
  async getByMediaIds(mediaIds: string[]): Promise<MediaEntities[]> {
    if (mediaIds.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < mediaIds.length; i += MEDIA_IDS_PER_REQUEST) {
      chunks.push(mediaIds.slice(i, i + MEDIA_IDS_PER_REQUEST));
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        this.getList(
          1,
          chunk.length,
          chunk.map((id) => this.pb.filter('id = {:id}', { id })).join(' || ')
        )
      )
    );
    // The view emits `entities` as a JSON column; normalize it so callers can
    // rely on the array type regardless of how PocketBase hands it back.
    return results.flatMap((result) =>
      result.items.map((item) => ({
        ...item,
        entities: mediaEntityLinksOf(item.entities),
      }))
    );
  }
}
