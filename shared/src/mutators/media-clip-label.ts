import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import {
  LABEL_TYPE_TO_REF_FIELD,
  MediaClipLabelInputSchema,
} from '../schema/media-clip-label';
import type {
  MediaClipLabel,
  MediaClipLabelInput,
} from '../schema/media-clip-label';
import type { TypedPocketBase } from '../types';
import { LabelType } from '../enums';
import { BaseMutator, type MutatorOptions } from './base';

/**
 * Parameters for linking a label record to a media clip.
 */
export interface LinkLabelParams {
  workspaceId: string;
  clipId: string;
  labelType: LabelType;
  /** Id of the record in the label collection matching labelType */
  labelId: string;
  /** Label confidence at link time */
  confidence?: number;
  /** Link context, e.g. the matched transcript text */
  metadata?: Record<string, unknown>;
}

/**
 * Mutator for MediaClipLabels — the explicit many-to-many join between
 * MediaClips and the label collections. Rows record why a clip exists
 * (created from this transcript portion, this face track, etc.) and keep
 * pointing at the label even after the clip is edited.
 */
export class MediaClipLabelMutator extends BaseMutator<
  MediaClipLabel,
  MediaClipLabelInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<MediaClipLabel> {
    return this.pb.collection('MediaClipLabels');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: MediaClipLabelInput
  ): Promise<MediaClipLabelInput> {
    return MediaClipLabelInputSchema.parse(input);
  }

  /**
   * Get all label links for a media clip, with the label records expanded
   * @param clipId The media clip ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param expand Expand paths override; defaults to every Label*Ref
   * @returns List of label links with each Label*Ref expanded
   */
  async getByClip(
    clipId: string,
    page = 1,
    perPage = 100,
    expand?: string[]
  ): Promise<ListResult<MediaClipLabel>> {
    const filter = this.pb.filter('MediaClipRef = {:clipId}', { clipId });
    return this.getList(
      page,
      perPage,
      filter,
      'created',
      expand ?? Object.values(LABEL_TYPE_TO_REF_FIELD)
    );
  }

  /**
   * Reverse lookup: get all clip links that point at a given label record
   * @param labelType The label type (determines which Label*Ref to match)
   * @param labelId The label record ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of label links with MediaClipRef expanded
   */
  async getByLabel(
    labelType: LabelType,
    labelId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaClipLabel>> {
    const refField = LABEL_TYPE_TO_REF_FIELD[labelType];
    const filter = this.pb.filter(`${refField} = {:labelId}`, { labelId });
    return this.getList(page, perPage, filter, '-created', ['MediaClipRef']);
  }

  /**
   * Link a label record to a media clip. Idempotent: returns the existing
   * link if the (clip, label) edge already exists.
   */
  async linkLabel(params: LinkLabelParams): Promise<MediaClipLabel> {
    const refField = LABEL_TYPE_TO_REF_FIELD[params.labelType];

    const existing = await this.getFirstByFilter(
      this.pb.filter(`MediaClipRef = {:clipId} && ${refField} = {:labelId}`, {
        clipId: params.clipId,
        labelId: params.labelId,
      })
    );
    if (existing) {
      return existing;
    }

    const input: MediaClipLabelInput = {
      WorkspaceRef: params.workspaceId,
      MediaClipRef: params.clipId,
      labelType: params.labelType,
      confidence: params.confidence,
      metadata: params.metadata,
    };
    input[refField] = params.labelId;

    return this.create(input);
  }

  /**
   * Remove the link between a media clip and a label record
   * @returns true if a link was found and deleted, false otherwise
   */
  async unlinkLabel(
    clipId: string,
    labelType: LabelType,
    labelId: string
  ): Promise<boolean> {
    const refField = LABEL_TYPE_TO_REF_FIELD[labelType];
    const existing = await this.getFirstByFilter(
      this.pb.filter(`MediaClipRef = {:clipId} && ${refField} = {:labelId}`, {
        clipId,
        labelId,
      })
    );
    if (!existing) {
      return false;
    }
    return this.delete(existing.id);
  }
}
