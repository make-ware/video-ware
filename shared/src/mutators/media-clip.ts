import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaClipInputSchema } from '../schema';
import type {
  MediaClip,
  MediaClipInput,
  LabelShot,
  LabelPerson,
  LabelObject,
  LabelFace,
  LabelSpeaker,
  LabelSpeech,
  LabelSegment,
  LabelText,
} from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { MediaClipLabelMutator } from './media-clip-label';
import { ClipType, LabelType } from '../enums';

export type ActualizableLabel =
  | LabelShot
  | LabelPerson
  | LabelObject
  | LabelFace
  | LabelSpeaker
  | LabelSpeech
  | LabelSegment
  | LabelText;

/**
 * Options for filtering media clips by workspace
 */
export interface GetByWorkspaceOptions {
  /** Filter by clip type (e.g., 'USER', 'RANGE', 'SHOT') */
  type?: string;
  /** Search query to filter by clip label or media name */
  searchQuery?: string;
  /** Filter clips to only those whose media is in this directory */
  directoryId?: string;
}

export class MediaClipMutator extends BaseMutator<MediaClip, MediaClipInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<MediaClip> {
    return this.pb.collection('MediaClips');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [
        'WorkspaceRef',
        'MediaRef',
        'MediaRef.UploadRef',
        'MediaRef.filmstripFileRefs',
      ],
      filter: [],
      sort: ['start'], // Sort by start time by default
    };
  }

  protected async validateInput(
    input: MediaClipInput
  ): Promise<MediaClipInput> {
    return MediaClipInputSchema.parse(input);
  }

  /**
   * Get media clips by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of media clips for the media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaClip>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Get media clips by workspace with optional filtering
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @param options Optional filtering options (type, searchQuery)
   * @returns List of media clips for the workspace with expanded MediaRef
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50,
    options?: GetByWorkspaceOptions
  ): Promise<ListResult<MediaClip>> {
    const filters: string[] = [`WorkspaceRef = "${workspaceId}"`];

    // Add type filter if provided
    if (options?.type) {
      filters.push(`type = "${options.type}"`);
    }

    // Add directory filter if provided (filter via media relation)
    if (options?.directoryId) {
      if (options.directoryId === 'root') {
        filters.push(`MediaRef.DirectoryRef = ""`);
      } else {
        filters.push(`MediaRef.DirectoryRef = "${options.directoryId}"`);
      }
    }

    // Add search query filter if provided
    // Search in clip label/description/type and the source media's
    // label/description/filename (via relation)
    if (options?.searchQuery) {
      const searchTerm = options.searchQuery.trim();
      if (searchTerm) {
        filters.push(
          `(label ~ "${searchTerm}" || description ~ "${searchTerm}" || type ~ "${searchTerm}" || MediaRef.label ~ "${searchTerm}" || MediaRef.description ~ "${searchTerm}" || MediaRef.UploadRef.name ~ "${searchTerm}")`
        );
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      '-created', // Sort by most recent first
      [
        'MediaRef',
        'MediaRef.UploadRef',
        'MediaRef.thumbnailFileRef',
        'MediaRef.spriteFileRef',
        'MediaRef.filmstripFileRefs',
      ]
    );
  }

  /**
   * Fetch MediaClips by id, with MediaRef/UploadRef/thumbnail expanded.
   * Used to hydrate clip/media/thumbnail details for search results coming
   * from the ClipLabelSearch view. Ids are system-generated but are bound via
   * pb.filter for consistency. Result order is not significant — callers
   * re-order by relevance.
   */
  async getByIds(ids: string[], perPage = 50): Promise<ListResult<MediaClip>> {
    if (ids.length === 0) {
      return { page: 1, perPage, totalItems: 0, totalPages: 0, items: [] };
    }

    const params: Record<string, string> = {};
    const orClauses = ids.map((id, i) => {
      params[`id${i}`] = id;
      return `id = {:id${i}}`;
    });
    const filter = this.pb.filter(`(${orClauses.join(' || ')})`, params);

    return this.getList(1, perPage, filter, '-created', [
      'MediaRef',
      'MediaRef.UploadRef',
      'MediaRef.thumbnailFileRef',
      'MediaRef.spriteFileRef',
    ]);
  }

  /**
   * Search MediaClips within a workspace by clip label/description or their
   * source media's label/description/upload filename. Used by the "Metadata"
   * search tab. The free-text `query` is bound via pb.filter to avoid
   * filter-string injection.
   */
  async searchClipMetadata(
    workspaceId: string,
    query: string,
    page = 1,
    perPage = 5
  ): Promise<ListResult<MediaClip>> {
    const filter = this.pb.filter(
      'WorkspaceRef = {:ws} && (label ~ {:q} || description ~ {:q} || MediaRef.label ~ {:q} || MediaRef.description ~ {:q} || MediaRef.UploadRef.name ~ {:q})',
      { ws: workspaceId, q: query }
    );
    return this.getList(page, perPage, filter, '-created', [
      'MediaRef',
      'MediaRef.UploadRef',
      'MediaRef.thumbnailFileRef',
      'MediaRef.spriteFileRef',
    ]);
  }

  /**
   * Find a derived clip by media reference and source label ID
   * @param mediaRef The media ID
   * @param sourceLabelId The source label_clip ID
   * @returns The existing derived clip or null if not found
   */
  async findDerivedClip(
    mediaRef: string,
    sourceLabelId: string
  ): Promise<MediaClip | null> {
    const filter = this.pb.filter(
      'MediaRef = {:mediaRef} && clipData.sourceId = {:sourceLabelId}',
      { mediaRef, sourceLabelId }
    );
    const result = await this.getList(1, 1, filter);
    return result.items.length > 0 ? result.items[0] : null;
  }

  /**
   * Create a MediaClip from a LabelClip or a source label
   * @param source The source label_clip or source label (Shot, Person, Object, Face)
   * @param labelType The label type (required if source is NOT a LabelClip)
   * @param processor The processor version to set on the clip
   * @returns The created or existing MediaClip
   */
  async createFromLabel(
    labelInput: ActualizableLabel,
    labelType: LabelType,
    processor: string
  ): Promise<MediaClip> {
    // Map labelType to ClipType
    const typeMapping: Record<LabelType, ClipType> = {
      [LabelType.OBJECT]: ClipType.OBJECT,
      [LabelType.SHOT]: ClipType.SHOT,
      [LabelType.PERSON]: ClipType.PERSON,
      [LabelType.SPEECH]: ClipType.SPEECH,
      [LabelType.SPEAKER]: ClipType.SPEECH,
      [LabelType.FACE]: ClipType.FACE,
      [LabelType.SEGMENT]: ClipType.RANGE,
      [LabelType.TEXT]: ClipType.SPEECH,
    };

    const clipType = typeMapping[labelType];

    // Extract confidence (LabelFace uses avgConfidence, others use confidence)
    const confidence =
      'confidence' in labelInput
        ? labelInput.confidence
        : 'avgConfidence' in labelInput
          ? labelInput.avgConfidence
          : 0;

    // Extract version (only LabelObject and LabelFace have version)
    const version =
      'version' in labelInput && labelInput.version ? labelInput.version : 1;

    // Create the MediaClip input
    const clipInput: MediaClipInput = {
      WorkspaceRef: labelInput.WorkspaceRef,
      MediaRef: labelInput.MediaRef,
      type: clipType,
      start: labelInput.start,
      end: labelInput.end,
      duration: labelInput.duration,
      version: version,
      processor: processor,
      clipData: {
        sourceId: labelInput.id,
        sourceType: 'label',
        labelType: labelType,
        confidence: confidence,
      },
    };

    const clip = await this.create(clipInput);

    // Record provenance in MediaClipLabels: the join row keeps pointing at
    // the source label even after the clip is edited away from the label's
    // time window (clipData.sourceId alone is not queryable per label type).
    try {
      await new MediaClipLabelMutator(this.pb).linkLabel({
        workspaceId: labelInput.WorkspaceRef,
        clipId: clip.id,
        labelType,
        labelId: labelInput.id,
        confidence,
      });
    } catch (err) {
      throw new Error(
        `Clip ${clip.id} created but provenance link failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    return clip;
  }
}
