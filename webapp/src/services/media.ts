import type { TypedPocketBase, Expanded } from '@project/shared/types';
import {
  MediaMutator,
  FileMutator,
  MediaClipMutator,
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
import { ProcessingProvider } from '@project/shared';

/**
 * Media with preview assets
 */
export type MediaWithPreviews<
  E extends keyof MediaRelations = 'thumbnailFileRef' | 'spriteFileRef',
> = Expanded<Media, MediaRelations, E> & {
  thumbnailUrl?: string;
  spriteUrl?: string;
  thumbnailFileRecord?: FileRecord;
  spriteFileRecord?: FileRecord;
  clips?: MediaClip[];
};

/**
 * Media service that provides high-level media operations
 * Handles media retrieval with preview assets and metadata
 */
export class MediaService {
  private mediaMutator: MediaMutator;
  private fileMutator: FileMutator;
  private mediaClipMutator: MediaClipMutator;
  private taskMutator: TaskMutator;
  private uploadMutator: UploadMutator;
  private labelJobMutator: LabelJobMutator;

  constructor(pb: TypedPocketBase) {
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
  ): Promise<MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef'> | null> {
    const media = await this.mediaMutator.getById(mediaId, [
      'thumbnailFileRef',
      'spriteFileRef',
    ]);
    if (!media) {
      return null;
    }

    return this.enrichMediaWithPreviews(media);
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
  ): Promise<MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef'>[]> {
    const result = await this.mediaMutator.getByWorkspace(
      workspaceId,
      page,
      perPage,
      ['thumbnailFileRef', 'spriteFileRef']
    );

    // Enrich each media item with preview URLs
    const enrichedMedia = await Promise.all(
      result.items.map((media) => this.enrichMediaWithPreviews(media))
    );

    return enrichedMedia;
  }

  /**
   * Get media by upload ID
   * @param uploadId The upload ID
   * @returns Media with preview URLs or null if not found
   */
  async getMediaByUpload(
    uploadId: string
  ): Promise<MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef'> | null> {
    const media = await this.mediaMutator.getByUpload(uploadId, [
      'thumbnailFileRef',
      'spriteFileRef',
    ]);
    if (!media) {
      return null;
    }

    return this.enrichMediaWithPreviews(media);
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
   * Regenerate a specific label job
   * @param mediaId The media ID
   * @param type The label job type
   * @returns The updated or created label job
   */
  async regenerateLabel(mediaId: string, type: string): Promise<LabelJob> {
    const config: LabelsFlowConfig = {
      confidenceThreshold: 0.5,
      detectObjects: type === 'object',
      detectLabels: type === 'shot',
      detectFaces: type === 'face',
      detectPersons: type === 'person',
      detectSpeech: type === 'speech',
    };

    const task = await this.createTaskForLabel(mediaId, undefined, config);

    const existing = await this.labelJobMutator.getByType(mediaId, type);
    if (existing) {
      return this.labelJobMutator.update(existing.id, {
        TaskRef: task.id,
      });
    } else {
      return this.labelJobMutator.create({
        MediaRef: mediaId,
        jobType: type,
        TaskRef: task.id,
      });
    }
  }

  /**
   * Enrich media with preview URLs and clips
   * @param media The media record
   * @returns Media with preview URLs and clips
   */
  private async enrichMediaWithPreviews<
    E extends keyof MediaRelations = 'thumbnailFileRef' | 'spriteFileRef',
  >(media: Expanded<Media, MediaRelations, E>): Promise<MediaWithPreviews<E>> {
    const enriched = { ...media } as MediaWithPreviews<E>;

    // Get thumbnail URL from expand if available
    if (
      'expand' in media &&
      media.expand &&
      'thumbnailFileRef' in media.expand
    ) {
      const thumbnailFile = media.expand.thumbnailFileRef as
        | FileRecord
        | undefined;
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

    // Default configuration if none provided
    const defaultConfig: LabelsFlowConfig = {
      confidenceThreshold: 0.5,
      detectObjects: true,
      detectLabels: true,
      detectFaces: true,
      detectPersons: true,
      detectSpeech: true,
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
