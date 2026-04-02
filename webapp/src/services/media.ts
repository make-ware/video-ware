import type { TypedPocketBase, Expanded } from '@project/shared/types';
import type { ListResult, RecordModel } from 'pocketbase';
import {
  MediaMutator,
  FileMutator,
  MediaClipMutator,
  TaskMutator,
  UploadMutator,
  LabelJobMutator,
  LabelShotMutator,
  LabelFaceMutator,
  LabelPersonMutator,
  LabelObjectMutator,
  LabelSegmentMutator,
  LabelSpeechMutator,
  LabelTrackMutator,
  MediaRecommendationMutator,
  TimelineClipMutator,
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
  private labelShotMutator: LabelShotMutator;
  private labelFaceMutator: LabelFaceMutator;
  private labelPersonMutator: LabelPersonMutator;
  private labelObjectMutator: LabelObjectMutator;
  private labelSegmentMutator: LabelSegmentMutator;
  private labelSpeechMutator: LabelSpeechMutator;
  private labelTrackMutator: LabelTrackMutator;
  private mediaRecommendationMutator: MediaRecommendationMutator;
  private timelineClipMutator: TimelineClipMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.mediaMutator = new MediaMutator(pb);
    this.fileMutator = new FileMutator(pb);
    this.mediaClipMutator = new MediaClipMutator(pb);
    this.taskMutator = new TaskMutator(pb);
    this.uploadMutator = new UploadMutator(pb);
    this.labelJobMutator = new LabelJobMutator(pb);
    this.labelShotMutator = new LabelShotMutator(pb);
    this.labelFaceMutator = new LabelFaceMutator(pb);
    this.labelPersonMutator = new LabelPersonMutator(pb);
    this.labelObjectMutator = new LabelObjectMutator(pb);
    this.labelSegmentMutator = new LabelSegmentMutator(pb);
    this.labelSpeechMutator = new LabelSpeechMutator(pb);
    this.labelTrackMutator = new LabelTrackMutator(pb);
    this.mediaRecommendationMutator = new MediaRecommendationMutator(pb);
    this.timelineClipMutator = new TimelineClipMutator(pb);
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
   * Get media in a specific directory with preview assets
   */
  async getMediaByDirectory(
    directoryId: string,
    page = 1,
    perPage = 50
  ): Promise<MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef'>[]> {
    const result = await this.mediaMutator.getByDirectory(
      directoryId,
      page,
      perPage,
      ['thumbnailFileRef', 'spriteFileRef']
    );

    return Promise.all(
      result.items.map((media) => this.enrichMediaWithPreviews(media))
    );
  }

  /**
   * Get media at the workspace root (no directory assigned)
   */
  async getMediaByWorkspaceRoot(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<MediaWithPreviews<'thumbnailFileRef' | 'spriteFileRef'>[]> {
    const result = await this.mediaMutator.getByWorkspaceRoot(
      workspaceId,
      page,
      perPage,
      ['thumbnailFileRef', 'spriteFileRef']
    );

    return Promise.all(
      result.items.map((media) => this.enrichMediaWithPreviews(media))
    );
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
   * Fully delete a media entity and all related records.
   * Preserves timeline clips but marks them as mediaMissing.
   */
  async deleteMedia(mediaId: string): Promise<DeleteMediaResult> {
    const errors: string[] = [];

    // 1. Fetch media record
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    const { UploadRef: uploadId, WorkspaceRef: workspaceId } = media;

    // 2. Mark timeline clips as mediaMissing (update, don't delete)
    try {
      await this.markTimelineClipsAsMissing(mediaId);
    } catch (error) {
      errors.push(
        `Timeline clip update: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 3. Delete all label data in parallel
    const labelResults = await Promise.allSettled([
      this.deleteAllRecords(this.labelShotMutator, mediaId),
      this.deleteAllRecords(this.labelFaceMutator, mediaId),
      this.deleteAllRecords(this.labelPersonMutator, mediaId),
      this.deleteAllRecords(this.labelObjectMutator, mediaId),
      this.deleteAllRecords(this.labelSegmentMutator, mediaId),
      this.deleteAllRecords(this.labelSpeechMutator, mediaId),
      this.deleteAllRecords(this.labelTrackMutator, mediaId),
    ]);
    labelResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        const types = [
          'shots',
          'faces',
          'persons',
          'objects',
          'segments',
          'speech',
          'tracks',
        ];
        errors.push(`Label ${types[i]} delete: ${r.reason}`);
      }
    });

    // 4. Delete media clips
    try {
      await this.deleteAllRecords(this.mediaClipMutator, mediaId);
    } catch (error) {
      errors.push(
        `Media clips: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 5. Delete media recommendations
    try {
      await this.deleteAllRecommendations(mediaId);
    } catch (error) {
      errors.push(
        `Recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 6. Delete label jobs (query without expand to avoid 400 on stale TaskRef)
    try {
      await this.deleteAllLabelJobs(mediaId);
    } catch (error) {
      errors.push(
        `Label jobs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 7. Delete tasks (by mediaId and uploadId)
    try {
      await this.deleteTasksBySourceId(mediaId);
      if (uploadId) {
        await this.deleteTasksBySourceId(uploadId);
      }
    } catch (error) {
      errors.push(
        `Tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 8. Delete file records (collect s3Keys for storage cleanup)
    const s3Keys: string[] = [];
    try {
      const page = 1;
      while (true) {
        const files = await this.fileMutator.getByMedia(mediaId, page, 100);
        if (files.items.length === 0) break;
        for (const file of files.items) {
          if (file.s3Key) s3Keys.push(file.s3Key);
        }
        await Promise.allSettled(
          files.items.map((file) => this.fileMutator.delete(file.id))
        );
        if (files.items.length < 100) break;
      }
    } catch (error) {
      errors.push(
        `Files: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 9. Delete upload record
    if (uploadId) {
      try {
        await this.uploadMutator.delete(uploadId);
      } catch (error) {
        errors.push(
          `Upload: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // 10. Delete media record
    try {
      await this.mediaMutator.delete(mediaId);
    } catch (error) {
      errors.push(
        `Media: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // 11. Fire-and-forget storage cleanup
    if (uploadId && workspaceId) {
      this.cleanupStorage(workspaceId, uploadId).catch((error) => {
        console.error('Storage cleanup failed:', error);
      });
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
   * Mark all timeline clips referencing this media as mediaMissing
   */
  private async markTimelineClipsAsMissing(mediaId: string): Promise<void> {
    let page = 1;
    while (true) {
      const result = await this.timelineClipMutator.getByMedia(
        mediaId,
        page,
        100
      );
      if (result.items.length === 0) break;
      await Promise.allSettled(
        result.items.map((clip) =>
          this.timelineClipMutator.update(clip.id, {
            MediaClipRef: '',
            meta: { ...clip.meta, mediaMissing: true },
          })
        )
      );
      if (result.items.length < 100) break;
      page++;
    }
  }

  /**
   * Paginated fetch-and-delete for any mutator with getByMedia
   */
  private async deleteAllRecords(
    mutator: {
      getByMedia: (
        id: string,
        page?: number,
        perPage?: number
      ) => Promise<ListResult<RecordModel>>;
      delete: (id: string) => Promise<boolean>;
    },
    mediaId: string
  ): Promise<void> {
    while (true) {
      // Always fetch page 1 since previous items were deleted
      const result = await mutator.getByMedia(mediaId, 1, 100);
      if (result.items.length === 0) break;
      await Promise.allSettled(
        result.items.map((item) => mutator.delete(item.id))
      );
      if (result.items.length < 100) break;
    }
  }

  /**
   * Delete all label jobs for a media, querying without expand
   * to avoid 400 errors from stale TaskRef relations
   */
  private async deleteAllLabelJobs(mediaId: string): Promise<void> {
    while (true) {
      const result = await this.pb
        .collection('LabelJobs')
        .getList(1, 100, {
          filter: `MediaRef = "${mediaId}"`,
        });
      if (result.items.length === 0) break;
      await Promise.allSettled(
        result.items.map((job) =>
          this.pb.collection('LabelJobs').delete(job.id)
        )
      );
      if (result.items.length < 100) break;
    }
  }

  /**
   * Paginated fetch-and-delete for media recommendations
   */
  private async deleteAllRecommendations(mediaId: string): Promise<void> {
    while (true) {
      const result = await this.mediaRecommendationMutator.getByMedia(
        mediaId,
        undefined,
        1,
        100
      );
      if (result.items.length === 0) break;
      await Promise.allSettled(
        result.items.map((item) =>
          this.mediaRecommendationMutator.delete(item.id)
        )
      );
      if (result.items.length < 100) break;
    }
  }

  /**
   * Delete all tasks matching a sourceId
   */
  private async deleteTasksBySourceId(sourceId: string): Promise<void> {
    while (true) {
      const result = await this.taskMutator.getBySourceId(sourceId, 1, 100);
      if (result.items.length === 0) break;
      await Promise.allSettled(
        result.items.map((task) => this.taskMutator.delete(task.id))
      );
      if (result.items.length < 100) break;
    }
  }

  /**
   * Call the storage cleanup API route to delete files from storage
   */
  private async cleanupStorage(
    workspaceId: string,
    uploadId: string
  ): Promise<void> {
    try {
      const response = await fetch('/api-next/media/delete-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, uploadId }),
      });
      if (!response.ok) {
        console.error(
          'Storage cleanup returned:',
          response.status,
          await response.text()
        );
      }
    } catch (error) {
      console.error('Storage cleanup request failed:', error);
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
