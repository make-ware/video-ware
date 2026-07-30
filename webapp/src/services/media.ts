import type { TypedPocketBase, Expanded } from '@project/shared/types';
import {
  MediaMutator,
  FileMutator,
  MediaClipMutator,
  MediaTagMutator,
  TaskMutator,
  UploadMutator,
  LabelJobMutator,
} from '@project/shared/mutator';
import type {
  Media,
  MediaRelations,
  File as FileRecord,
  MediaClip,
  Task,
  LabelsFlowConfig,
  DetectLabelsPayload,
  ProcessUploadPayload,
  LabelJob,
} from '@project/shared';
import { ProcessingProvider, ALL_LABEL_DETECTIONS } from '@project/shared';
import type { ListResult } from 'pocketbase';

/**
 * Media with preview assets
 */
export type MediaWithPreviews<
  E extends keyof MediaRelations =
    'thumbnailFileRef' | 'spriteFileRef' | 'UploadRef',
> = Expanded<Media, MediaRelations, E> & {
  thumbnailUrl?: string;
  spriteUrl?: string;
  thumbnailFileRecord?: FileRecord;
  spriteFileRecord?: FileRecord;
  clips?: MediaClip[];
};

/** The canonical media list item shape served by `MediaService.listMedia`. */
export type MediaListItem = MediaWithPreviews<
  'thumbnailFileRef' | 'spriteFileRef' | 'UploadRef'
>;

/** Server-side filters for `MediaService.listMedia`. */
export interface MediaListQuery {
  workspaceId: string;
  /** null/undefined = all directories; '' = workspace root; id = directory. */
  directoryId?: string | null;
  /** 'all'/undefined = no type filter. */
  mediaType?: string;
  /** null/undefined = no entity filter; id = tagged with or appearing as it. */
  entityId?: string | null;
  /** Matched against label, description, and UploadRef.name. */
  search?: string;
}

/**
 * Media service that provides high-level media operations
 * Handles media retrieval with preview assets and metadata
 */
export interface DeleteMediaResult {
  success: boolean;
  mediaId: string;
  errors: string[];
}

export class MediaService {
  private pb: TypedPocketBase;
  private mediaMutator: MediaMutator;
  private fileMutator: FileMutator;
  private mediaClipMutator: MediaClipMutator;
  private taskMutator: TaskMutator;
  private uploadMutator: UploadMutator;
  private labelJobMutator: LabelJobMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.mediaMutator = new MediaMutator(pb);
    this.fileMutator = new FileMutator(pb);
    this.mediaClipMutator = new MediaClipMutator(pb);
    this.taskMutator = new TaskMutator(pb);
    this.uploadMutator = new UploadMutator(pb);
    this.labelJobMutator = new LabelJobMutator(pb);
  }

  /**
   * Get media with preview assets (thumbnail and sprite URLs)
   * @param mediaId The media ID
   * @returns Media with preview URLs or null if not found
   */
  async getMediaWithPreviews(
    mediaId: string
  ): Promise<MediaWithPreviews<
    'thumbnailFileRef' | 'spriteFileRef' | 'UploadRef'
  > | null> {
    const media = await this.mediaMutator.getById(mediaId, [
      'thumbnailFileRef',
      'spriteFileRef',
      'UploadRef',
    ]);
    if (!media) {
      return null;
    }

    return this.enrichMedia(media);
  }

  /**
   * Get all media for a workspace with preview assets
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media with preview URLs
   */
  async getMediaByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<
    MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef' | 'UploadRef'>[]
  > {
    const result = await this.mediaMutator.getByWorkspace(
      workspaceId,
      page,
      perPage,
      ['thumbnailFileRef', 'spriteFileRef', 'UploadRef']
    );

    return result.items.map((media) => this.enrichMedia(media));
  }

  /**
   * Get media in a specific directory with preview assets
   */
  async getMediaByDirectory(
    directoryId: string,
    page = 1,
    perPage = 50
  ): Promise<
    MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef' | 'UploadRef'>[]
  > {
    const result = await this.mediaMutator.getByDirectory(
      directoryId,
      page,
      perPage,
      ['thumbnailFileRef', 'spriteFileRef', 'UploadRef']
    );

    return result.items.map((media) => this.enrichMedia(media));
  }

  /**
   * List media with server-side filters, sort, and the full pagination
   * envelope preserved (unlike getMediaByWorkspace/getMediaByDirectory,
   * which return bare arrays). User input is bound via pb.filter — never
   * interpolated into the filter string.
   */
  async listMedia(
    query: MediaListQuery,
    page = 1,
    perPage = 24,
    sort = '-created'
  ): Promise<ListResult<MediaListItem>> {
    const clauses = [
      this.pb.filter('WorkspaceRef = {:ws}', { ws: query.workspaceId }),
    ];
    if (query.directoryId !== null && query.directoryId !== undefined) {
      clauses.push(
        this.pb.filter('DirectoryRef = {:dir}', { dir: query.directoryId })
      );
    }
    if (query.mediaType && query.mediaType !== 'all') {
      clauses.push(
        this.pb.filter('mediaType = {:type}', { type: query.mediaType })
      );
    }
    if (query.entityId) {
      // "Tagged with, or appears as" — the curator's tag plus label
      // attribution. The label side reads LabelEntity directly rather than
      // hopping through LabelTrack: LabelEntity is per-media and is the only
      // link point, so this is one hop AND it covers shots and segments,
      // which carry no LabelTrackRef and were invisible to a track-rooted
      // filter. Kept in step with `listMediaIdsLinkedToEntity` below, which
      // mirrors this filter client-side for realtime inserts.
      clauses.push(
        this.pb.filter(
          '(MediaTags_via_MediaRef.EntityRef ?= {:entity}' +
            ' || LabelEntity_via_MediaRef.EntityRef ?= {:entity})',
          { entity: query.entityId }
        )
      );
    }
    const search = query.search?.trim();
    if (search) {
      clauses.push(
        this.pb.filter(
          '(label ~ {:q} || description ~ {:q} || UploadRef.name ~ {:q})',
          { q: search }
        )
      );
    }

    const result = await this.mediaMutator.getList(
      page,
      perPage,
      clauses,
      sort,
      ['thumbnailFileRef', 'spriteFileRef', 'UploadRef']
    );

    return { ...result, items: result.items.map((m) => this.enrichMedia(m)) };
  }

  /**
   * Media ids linked to an entity — the client-side mirror of `listMedia`'s
   * entity filter, used to decide whether a realtime Media event belongs in a
   * filtered list (a Media record carries no tag or label data of its own).
   *
   * Best-effort by design: `cap` bounds both sweeps, so on a very heavily
   * linked entity the tail is missing and those media simply don't get
   * live-inserted until the next refetch. Never used as the server filter.
   */
  async listMediaIdsLinkedToEntity(
    entityId: string,
    cap = 2000
  ): Promise<Set<string>> {
    const [tags, labelEntities] = await Promise.all([
      new MediaTagMutator(this.pb).getByEntity(entityId, 1, cap),
      this.pb.collection('LabelEntity').getList(1, cap, {
        filter: this.pb.filter('EntityRef = {:entity}', { entity: entityId }),
        fields: 'MediaRef',
      }),
    ]);
    const ids = new Set<string>();
    for (const tag of tags.items) ids.add(tag.MediaRef);
    // MediaRef is optional on LabelEntity: the per-instance migration's
    // safety catch leaves a legacy workspace-wide row in place if anything
    // still points at it. Such a row belongs to no media.
    for (const entity of labelEntities.items) {
      if (entity.MediaRef) ids.add(entity.MediaRef);
    }
    return ids;
  }

  /**
   * Get media by upload ID
   * @param uploadId The upload ID
   * @returns Media with preview URLs or null if not found
   */
  async getMediaByUpload(
    uploadId: string
  ): Promise<MediaWithPreviews<
    'thumbnailFileRef' | 'spriteFileRef' | 'UploadRef'
  > | null> {
    const media = await this.mediaMutator.getByUpload(uploadId, [
      'thumbnailFileRef',
      'spriteFileRef',
      'UploadRef',
    ]);
    if (!media) {
      return null;
    }

    return this.enrichMedia(media);
  }

  /**
   * Get clips for a media item
   * @param mediaId The media ID
   * @returns List of media clips
   */
  async getMediaClips(mediaId: string): Promise<MediaClip[]> {
    const result = await this.mediaClipMutator.getByMedia(mediaId);
    return result.items;
  }

  /**
   * Get label jobs for a media item
   * @param mediaId The media ID
   * @returns List of label jobs
   */
  async getLabelJobs(mediaId: string): Promise<LabelJob[]> {
    return this.labelJobMutator.getByMedia(mediaId);
  }

  /**
   * Regenerate a specific label job by creating a detect_labels task with
   * only that type enabled. The worker points the LabelJob record at the
   * task when it enqueues the flow (JobService.syncLabelJobs), so all
   * creation paths (webapp, ingest, CLI) stay consistent.
   * @param mediaId The media ID
   * @param type The label job type
   * @returns The created task
   */
  async regenerateLabel(mediaId: string, type: string): Promise<Task> {
    const config: LabelsFlowConfig = {
      confidenceThreshold: 0.5,
      detectObjects: type === 'object',
      detectLabels: type === 'shot',
      detectFaces: type === 'face',
      detectPersons: type === 'person',
      detectText: type === 'text',
      detectSpeech: type === 'speech',
      detectSpeakers: type === 'speaker',
    };

    return this.createTaskForLabel(mediaId, undefined, config);
  }

  /**
   * Delete a media entity. Deleting the Media record is all that is required —
   * the database and PocketBase hooks own the full cascade, so this behaves
   * identically for every caller (webapp, CLI, dashboard, raw REST):
   *  - child collections (Files, MediaClips, Captions, Label*, LabelJobs) cascade
   *    via their MediaRef relations, and the hook-uploads-delete / hook-files-delete
   *    tombstone hooks queue any external blobs for the weekly `cleanup` worker task;
   *  - the hook-media-delete hook flags referencing TimelineClips as
   *    mediaMissing (preserving them), then deletes the orphaned Upload and any
   *    Tasks keyed to the media/upload.
   * See pb/pb_hooks/hook-media-delete.pb.js and pb_migrations/*_cascade_*.
   */
  async deleteMedia(mediaId: string): Promise<DeleteMediaResult> {
    const errors: string[] = [];

    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    try {
      await this.mediaMutator.delete(mediaId);
    } catch (error) {
      errors.push(
        `Media: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return {
      success: errors.length === 0,
      mediaId,
      errors,
    };
  }

  /**
   * Delete multiple media items in bulk with full cascade
   * Uses Promise.allSettled for resilience to partial failures
   */
  async bulkDeleteMedia(mediaIds: string[]): Promise<{
    succeeded: string[];
    failed: { id: string; error: string }[];
  }> {
    const results = await Promise.allSettled(
      mediaIds.map((id) => this.deleteMedia(id).then(() => id))
    );

    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(result.value);
      } else {
        failed.push({
          id: mediaIds[index],
          error:
            result.reason instanceof Error
              ? result.reason.message
              : 'Unknown error',
        });
      }
    });

    return { succeeded, failed };
  }

  /**
   * Enrich media with preview URLs from its expanded File relations.
   * Pure and synchronous so realtime handlers can enrich SSE records
   * without side effects.
   * @param media The media record
   * @returns Media with preview URLs
   */
  enrichMedia<
    E extends keyof MediaRelations = 'thumbnailFileRef' | 'spriteFileRef',
  >(media: Expanded<Media, MediaRelations, E>): MediaWithPreviews<E> {
    const enriched = { ...media } as MediaWithPreviews<E>;

    // Get thumbnail URL from expand if available
    if (
      'expand' in media &&
      media.expand &&
      'thumbnailFileRef' in media.expand
    ) {
      const thumbnailFile = media.expand.thumbnailFileRef as
        FileRecord | undefined;
      if (thumbnailFile) {
        enriched.thumbnailUrl = this.fileMutator.getFileUrl(thumbnailFile);
        enriched.thumbnailFileRecord = thumbnailFile;
      }
    }

    // Get sprite URL from expand if available
    if ('expand' in media && media.expand && 'spriteFileRef' in media.expand) {
      const spriteFile = media.expand.spriteFileRef as FileRecord | undefined;
      if (spriteFile) {
        enriched.spriteUrl = this.fileMutator.getFileUrl(spriteFile);
        enriched.spriteFileRecord = spriteFile;
      }
    }

    return enriched;
  }

  /**
   * Get media metadata
   * @param mediaId The media ID
   * @param expand Optional expand fields to include
   * @returns Media metadata or null if not found
   */
  async getMediaMetadata<E extends keyof MediaRelations = never>(
    mediaId: string,
    expand?: E | E[]
  ): Promise<Expanded<Media, MediaRelations, E> | null> {
    return this.mediaMutator.getById(mediaId, expand);
  }

  /**
   * Check if media has preview assets available
   * @param media The media record
   * @returns True if both thumbnail and sprite are available
   */
  hasPreviewAssets(media: Media): boolean {
    return !!(media.thumbnailFileRef && media.spriteFileRef);
  }

  /**
   * Get file URL for a file record
   * @param file The file record
   * @param filename The filename field (default: 'blob')
   * @returns The file URL
   */
  getFileUrl(file: FileRecord, filename = 'blob'): string {
    return this.fileMutator.getFileUrl(file, filename);
  }

  /**
   * Create a label detection task for a media item
   * @param mediaId The media ID
   * @param config Optional custom configuration for label detection
   * @param userId Optional user ID
   * @returns The created task
   */
  async createTaskForLabel(
    mediaId: string,
    userId?: string,
    config?: LabelsFlowConfig
  ): Promise<Task> {
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    // Get upload to get UserRef and externalPath
    const upload = await this.uploadMutator.getById(media.UploadRef);
    if (!upload) {
      throw new Error(`Upload not found for media ${mediaId}`);
    }

    const currentUserId = userId || upload.UserRef;
    if (!currentUserId) {
      throw new Error('User context required for task creation');
    }

    // Default configuration if none provided: request every detector so the
    // "Detect Labels" button runs all steps, including newly added ones.
    // ALL_LABEL_DETECTIONS is `Required`, so a new toggle forces this to update.
    const defaultConfig: LabelsFlowConfig = {
      confidenceThreshold: 0.5,
      ...ALL_LABEL_DETECTIONS,
    };

    const payload: DetectLabelsPayload = {
      mediaId,
      fileRef: upload.externalPath || '',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      config: { ...defaultConfig, ...config },
    };

    return this.taskMutator.createDetectLabelsTask(
      media.WorkspaceRef,
      currentUserId,
      mediaId,
      payload
    );
  }

  /**
   * Regenerate preview assets for a media item
   * @param mediaId The media ID
   * @param config Configuration for what to regenerate
   * @param userId Optional user ID
   * @returns The created task
   */
  async regeneratePreviews(
    mediaId: string,
    config: {
      thumbnail?: boolean;
      sprite?: boolean;
      filmstrip?: boolean;
      transcode?: boolean;
      audio?: boolean;
      waveform?: boolean;
    },
    userId?: string
  ): Promise<Task> {
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    const upload = await this.uploadMutator.getById(media.UploadRef);
    if (!upload) {
      throw new Error(`Upload not found for media ${mediaId}`);
    }

    const currentUserId = userId || upload.UserRef;
    if (!currentUserId) {
      throw new Error('User context required for task creation');
    }

    // Base payload
    const payload: ProcessUploadPayload = {
      uploadId: upload.id,
      mediaId: media.id,
      provider: ProcessingProvider.FFMPEG,
    };

    // Add configurations based on what is requested
    if (config.thumbnail) {
      payload.thumbnail = {
        timestamp: 'midpoint',
        width: 320,
        height: 180,
      };
    }

    if (config.sprite) {
      payload.sprite = {
        fps: 1,
        cols: 5,
        rows: 5,
        tileWidth: 160,
        tileHeight: 90,
      };
    }

    if (config.filmstrip) {
      payload.filmstrip = {
        cols: 100,
        rows: 1,
        tileWidth: 160,
      };
    }

    // Same geometry the ingest pipeline requests — see the waveform default in
    // worker/src/tasks/ingest-orchestrator.service.ts.
    if (config.waveform) {
      payload.waveform = {
        width: 1000,
        height: 200,
        pixelsPerSecond: 1,
        color: 'white',
        mono: true,
      };
    }

    if (config.transcode) {
      payload.transcode = {
        enabled: true,
        codec: 'h264',
        resolution: '720p',
      };
    }

    if (config.audio) {
      payload.audio = {
        enabled: true,
        format: 'mp3',
        bitrate: '128k',
      };
    }

    return this.taskMutator.createProcessUploadTask(
      media.WorkspaceRef,
      currentUserId,
      upload.id,
      payload
    );
  }
}

/**
 * Create a MediaService instance from a PocketBase client
 */
export function createMediaService(pb: TypedPocketBase): MediaService {
  return new MediaService(pb);
}
