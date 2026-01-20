import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegAudioExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeAudioStep,
  TaskTranscodeAudioStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import { FileType, FileSource } from '@project/shared';

/**
 * Processor for the AUDIO step
 * Extracts a stereo audio-only track from the video file
 */
@Injectable()
export class AudioStepProcessor extends BaseStepProcessor<
  TaskTranscodeAudioStep,
  TaskTranscodeAudioStepOutput
> {
  protected readonly logger = new Logger(AudioStepProcessor.name);

  constructor(
    private readonly audioExecutor: FFmpegAudioExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeAudioStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeAudioStepOutput> {
    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Get media to check for audio streams
    // We fetch it early to check if extraction is needed
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    const probeData = media?.mediaData as any; // ProbeOutput

    // Skip if no audio stream is detected
    if (media && probeData && !probeData.audio) {
      this.logger.log(
        `Skipping audio extraction for upload ${input.uploadId}: No audio stream detected`
      );
      return {} as TaskTranscodeAudioStepOutput;
    }

    // Determine output format and extension
    const format = input.format || 'mp3';
    const extension = format === 'aac' ? 'm4a' : format;
    const fileName = `audio.${extension}`;

    // Generate output path using FileResolver
    const audioPath = FileResolver.resolveOutputFilePath(
      upload.WorkspaceRef,
      input.uploadId,
      fileName,
      this.storageService
    );

    // Execute audio extraction
    await this.audioExecutor.execute(filePath, audioPath, {
      format,
      bitrate: input.bitrate || '192k',
      channels: input.channels || 2, // Default to stereo
      sampleRate: input.sampleRate || 48000,
    });

    // Create File record
    const storageKey = `uploads/${upload.WorkspaceRef}/${input.uploadId}/${FileType.AUDIO}/${fileName}`;

    const audioFile = await this.pocketbaseService.uploadFile({
      localFilePath: audioPath,
      fileName,
      fileType: FileType.AUDIO,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef: upload.WorkspaceRef,
      uploadRef: input.uploadId,
      mimeType: this.getMimeType(format),
    });

    // Clean up local file if using S3
    await this.storageService.cleanup(audioPath);

    // Update Media record
    if (media) {
      await this.pocketbaseService.updateMedia(media.id, {
        audioFileRef: audioFile.id,
      });
    }

    return { audioPath, audioFileId: audioFile.id };
  }

  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      aac: 'audio/aac',
      wav: 'audio/wav',
    };
    return mimeTypes[format] || 'audio/mpeg';
  }
}
