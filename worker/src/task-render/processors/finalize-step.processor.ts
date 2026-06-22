import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import type { StepJobData } from '../../queue/types/job.types';
import {
  TaskRenderFinalizeStep,
  TaskRenderFinalizeStepOutput,
} from '@project/shared/jobs';
import { FileType, FileSource, FileStatus, TaskStatus } from '@project/shared';
import { Readable } from 'stream';

/**
 * Processor for the FINALIZE step in rendering
 * Probes the rendered file, creates all database records, and cleans up
 */
@Injectable()
export class FinalizeRenderStepProcessor extends BaseStepProcessor<
  TaskRenderFinalizeStep,
  TaskRenderFinalizeStepOutput
> {
  protected readonly logger = new Logger(FinalizeRenderStepProcessor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FFmpegService
  ) {
    super();
  }

  async process(
    input: TaskRenderFinalizeStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderFinalizeStepOutput> {
    const { timelineId, timelineRenderId, workspaceId, version, format } =
      input;
    const taskId = job.data.taskId;

    this.logger.log(`Finalizing render for timeline ${timelineId}`);

    // Use deterministic path - same as execute step
    // Path: ./data/renders/<workspaceId>/<taskId>/output.<format>
    const localPath = this.storageService.getRenderOutputPath(
      workspaceId,
      taskId,
      format
    );
    const storagePath = `renders/${workspaceId}/${taskId}/output.${format}`;

    this.logger.log(`Probing rendered file at ${localPath}`);

    // Probe the video
    const probeResult = await this.ffmpegService.probe(localPath);
    const probeOutput = this.mapProbeResult(probeResult);

    // 3. Resolve timeline name
    const timeline =
      await this.pocketbaseService.timelineMutator.getById(timelineId);
    const timelineName = timeline?.name || 'Untitled';

    // 4. Create File record and upload to PocketBase (or S3 fallback)
    const fileName = `${timelineName}_render.${format}`;
    let fileRecord;

    const meta = {
      ...probeOutput,
      mimeType: this.getMimeType(format),
    };

    try {
      fileRecord = await this.pocketbaseService.uploadFile({
        localFilePath: localPath,
        fileName,
        fileType: FileType.RENDER,
        fileSource: FileSource.POCKETBASE, // Use POCKETBASE source as requested
        storageKey: storagePath,
        workspaceRef: workspaceId,
        mimeType: this.getMimeType(format),
        meta,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to upload render to PocketBase: ${errorMessage}. Attempting S3 fallback...`
      );

      // Attempt manual S3 upload
      try {
        const fs = await import('fs');
        const fileStream = fs.createReadStream(localPath);
        // Convert Node stream to Web Stream for storage service
        const webStream = Readable.toWeb(
          fileStream
        ) as unknown as ReadableStream;
        await this.storageService.upload(storagePath, webStream);
        this.logger.log(`Successfully uploaded render to S3: ${storagePath}`);

        // Try to create File record with S3 source
        // Note: This might still fail if PocketBase is completely down
        // But we at least saved the file to S3
        fileRecord = await this.pocketbaseService.createFile({
          name: fileName,
          size: probeResult.format.size,
          fileStatus: FileStatus.AVAILABLE,
          fileType: FileType.RENDER,
          fileSource: FileSource.S3,
          storageKey: storagePath,
          WorkspaceRef: workspaceId,
          meta,
        });
      } catch (fallbackError) {
        const fallbackErrorMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        this.logger.error(`S3 fallback upload failed: ${fallbackErrorMessage}`);
        throw error; // Throw the original error
      }
    }

    // 6. Attach the rendered file to the TimelineRender and mark it complete.
    // The entity is created up-front (by the client) and triggers this render
    // via a hook, so we update it here. Fall back to creating one for any
    // legacy path that didn't pre-create the record.
    let resolvedRenderId = timelineRenderId;
    if (resolvedRenderId) {
      await this.pocketbaseService.updateTimelineRender(resolvedRenderId, {
        FileRef: fileRecord.id,
        status: TaskStatus.SUCCESS,
        progress: 100,
      });
    } else {
      const created = await this.pocketbaseService.createTimelineRender({
        TimelineRef: timelineId,
        WorkspaceRef: workspaceId,
        version: version,
        FileRef: fileRecord.id,
        status: TaskStatus.SUCCESS,
        progress: 100,
      });
      resolvedRenderId = created.id;
    }

    // 7. Remove the whole render working directory (inputs, output, ffmpeg
    // scratch). The durable copy now lives in PocketBase/S3, so nothing reads
    // this local tree again — leaving it behind just pollutes the disk.
    await this.storageService.cleanupRenderDir(workspaceId, taskId);

    this.logger.log(`Successfully finalized render: ${resolvedRenderId}`);

    return {
      fileId: fileRecord.id,
      timelineRenderId: resolvedRenderId,
    };
  }

  private mapProbeResult(probeResult: {
    streams: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      codec_name?: string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
    format: {
      duration?: string | number;
      bit_rate?: string | number;
      format_name?: string;
      size?: string | number;
    };
  }): Record<string, unknown> {
    const videoStream = probeResult.streams.find(
      (s) => s.codec_type === 'video'
    );
    const parseFps = (fpsString: string | undefined): number => {
      if (!fpsString) return 0;
      const [num, den] = fpsString.split('/').map(Number);
      return den && den > 0 ? num / den : 0;
    };

    return {
      duration: parseFloat(String(probeResult.format.duration)) || 0,
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      codec: videoStream?.codec_name || 'unknown',
      fps:
        parseFps(videoStream?.r_frame_rate || videoStream?.avg_frame_rate) || 0,
      bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
      format: probeResult.format.format_name || 'unknown',
      size: parseInt(String(probeResult.format.size)) || undefined,
    };
  }

  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
    };
    return mimeTypes[format.toLowerCase()] || 'video/mp4';
  }
}
