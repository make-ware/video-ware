import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaTagInputSchema } from '../schema';
import type { MediaTag, MediaTagInput, MediaTagRelations } from '../schema';
import type { Expanded, TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

/**
 * Manual whole-media entity tags ("this media features Erik"). One row per
 * (media, entity) edge; the DB unique index makes `tag` idempotent under
 * races. Not part of the label pipeline — see schema/media-tag.ts.
 */
// Relations stays off the BaseMutator generics so getList keeps accepting
// arbitrary expand paths; getByMedia/getByEntity narrow their own expand.
export class MediaTagMutator extends BaseMutator<MediaTag, MediaTagInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<MediaTag> {
    return this.pb.collection('MediaTags');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: MediaTagInput): Promise<MediaTagInput> {
    return MediaTagInputSchema.parse(input);
  }

  /**
   * Tag a media with an entity. Idempotent: if the (media, entity) edge
   * already exists — including losing a creation race to the unique index —
   * the existing row is returned.
   *
   * Bypasses BaseMutator.create so an expected unique-index rejection isn't
   * logged as an error.
   */
  async tag(input: MediaTagInput): Promise<MediaTag> {
    const data = await this.validateInput(input);
    try {
      return await this.getCollection().create(data as Record<string, unknown>);
    } catch (error) {
      const existing = await this.getTag(input.MediaRef, input.EntityRef);
      if (existing) return existing;
      throw error;
    }
  }

  /**
   * Remove a (media, entity) tag. Returns false when no such tag exists —
   * untagging twice is a no-op, not an error.
   */
  async untag(mediaId: string, entityId: string): Promise<boolean> {
    const existing = await this.getTag(mediaId, entityId);
    if (!existing) return false;
    return this.delete(existing.id);
  }

  /** The (media, entity) edge row, or null. */
  async getTag(mediaId: string, entityId: string): Promise<MediaTag | null> {
    return this.getFirstByFilter(
      `MediaRef = "${mediaId}" && EntityRef = "${entityId}"`
    );
  }

  /** A media's tags, oldest first so chip order is stable. */
  async getByMedia<E extends keyof MediaTagRelations = never>(
    mediaId: string,
    page = 1,
    perPage = 100,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<MediaTag, MediaTagRelations, E>>> {
    return this.getList(
      page,
      perPage,
      `MediaRef = "${mediaId}"`,
      'created',
      expand
    );
  }

  /** All media tagged with an entity, newest tags first. */
  async getByEntity<E extends keyof MediaTagRelations = never>(
    entityId: string,
    page = 1,
    perPage = 100,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<MediaTag, MediaTagRelations, E>>> {
    return this.getList(
      page,
      perPage,
      `EntityRef = "${entityId}"`,
      '-created',
      expand
    );
  }
}
