import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';

/**
 * Step input/output types
 */
export interface UploadToGcsStepInput {
  type: 'upload_to_gcs';
  workspaceRef: string;
  mediaId: string;
  fileRef: string;
}

export interface UploadToGcsStepOutput {
  gcsUri: string;
  uploaded: boolean;
  alreadyExists: boolean;
}

/**
 * Processor for UPLOAD_TO_GCS step in detect_labels flow
 * Uploads local/S3 files to GCS for use by Video Intelligence and Speech-to-Text APIs
 * Uses deterministic paths so files can be reused across multiple analysis runs
 *
 * Each detection step in the labels flow owns its own UPLOAD_TO_GCS child job
 * (BullMQ flows are trees; siblings can't share a dependency), so several
 * upload jobs for the same media can run concurrently in one worker. The
 * in-flight map below collapses them onto a single download/upload/cleanup
 * pass; across workers the deterministic path + existence check (and GCS's
 * atomic object visibility) keep duplicate uploads safe, merely redundant.
 */
@Injectable()
export class UploadToGcsStepProcessor extends BaseStepProcessor<
  UploadToGcsStepInput,
  UploadToGcsStepOutput
> {
  protected readonly logger = new Logger(UploadToGcsStepProcessor.name);

  private readonly inFlight = new Map<string, Promise<UploadToGcsStepOutput>>();

  constructor(
    private readonly googleCloudService: GoogleCloudService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  /**
   * Upload file to GCS, sharing a single in-flight upload per media between
   * concurrent step jobs. Entries are removed once settled so a failed
   * attempt is retried fresh by BullMQ rather than replaying the rejection.
   */
  async process(
    input: UploadToGcsStepInput,
    _job: Job<StepJobData>
  ): Promise<UploadToGcsStepOutput> {
    const key = `${input.workspaceRef}/${input.mediaId}`;

    const existing = this.inFlight.get(key);
    if (existing) {
      this.logger.log(
        `Upload already in flight for media ${input.mediaId}, awaiting shared result`
      );
      return existing;
    }

    const upload = this.performUpload(input).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, upload);
    return upload;
  }

  /**
   * Upload file to GCS with deterministic path
   * Checks if file already exists to avoid redundant uploads
   */
  private async performUpload(
    input: UploadToGcsStepInput
  ): Promise<UploadToGcsStepOutput> {
    this.logger.log(`Uploading file to GCS for media ${input.mediaId}`);

    try {
      // If already a GCS URI, return as-is
      if (input.fileRef.startsWith('gs://')) {
        this.logger.log(`File already in GCS: ${input.fileRef}`);
        return {
          gcsUri: input.fileRef,
          uploaded: false,
          alreadyExists: true,
        };
      }

      // Get deterministic GCS path for temp storage
      const tempGcsUri = this.googleCloudService.getTempGcsUri(
        input.workspaceRef,
        input.mediaId
      );

      // Check if file already exists in GCS
      const exists =
        await this.googleCloudService.checkGcsFileExists(tempGcsUri);
      if (exists) {
        this.logger.log(`File already exists in GCS: ${tempGcsUri}`);
        return {
          gcsUri: tempGcsUri,
          uploaded: false,
          alreadyExists: true,
        };
      }

      // Resolve local file path (downloads from S3 if needed)
      this.logger.log(`Resolving local file path for: ${input.fileRef}`);
      const localPath = await this.storageService.resolveFilePath({
        storagePath: input.fileRef,
        recordId: input.mediaId,
      });

      // Upload to GCS with deterministic temp path
      this.logger.log(`Uploading local file to GCS: ${localPath}`);
      const gcsUri = await this.googleCloudService.uploadToGcsTempBucket(
        localPath,
        input.workspaceRef,
        input.mediaId
      );

      this.logger.log(`Successfully uploaded to GCS: ${gcsUri}`);

      return {
        gcsUri,
        uploaded: true,
        alreadyExists: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to upload to GCS for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(`GCS upload failed: ${errorMessage}`);
    } finally {
      // Clean up the temp download for this media (no-op in local mode and
      // when nothing was downloaded). Safe here because the downstream
      // detection steps read from the GCS URI, not the local temp file.
      // Runs on success AND failure so a stateless pod never leaks disk.
      await this.storageService.cleanupTemp(input.mediaId);
    }
  }

  /**
   * Get the processor version for this step
   */
  getProcessorVersion(): string {
    return 'upload-to-gcs:1.0.0';
  }
}
