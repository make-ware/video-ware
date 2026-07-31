import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegWaveformExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeWaveformStep,
  TaskTranscodeWaveformStepOutput,
} from '@project/shared/jobs';
import { ingestMeta, TranscodeStepType } from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import {
  FileType,
  FileSource,
  MediaType,
  planWaveformChunks,
  type ProbeOutput,
} from '@project/shared';

const WAVEFORM_MIME_TYPE = 'image/png';

/**
 * Processor for the WAVEFORM step
 *
 * Renders the media's audio track as PNG waveform images — one per chunk, at a
 * fixed pixels-per-second scale — and links them to the Media in chunk order.
 * Reads the ORIGINAL file rather than waiting on the AUDIO step's extracted
 * track: transcode children are independent siblings, and ffmpeg draws the
 * waveform straight from the source's audio stream either way.
 */
@Injectable()
export class WaveformStepProcessor extends BaseStepProcessor<
  TaskTranscodeWaveformStep,
  TaskTranscodeWaveformStepOutput
> {
  protected readonly logger = new Logger(WaveformStepProcessor.name);

  constructor(
    private readonly waveformExecutor: FFmpegWaveformExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeWaveformStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeWaveformStepOutput> {
    const empty: TaskTranscodeWaveformStepOutput = {
      waveformPath: '',
      waveformFileId: '',
      allWaveformFileIds: [],
    };

    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (!media) {
      throw new Error(`Media not found for upload ${input.uploadId}`);
    }

    // Images have no audio at all; video and audio media both do (or don't,
    // which the probe below answers).
    if (media.mediaType === MediaType.IMAGE) {
      this.logger.log(
        `Skipping waveform generation for image media: ${media.id}`
      );
      return empty;
    }

    // PROBE runs first in the flow, so by now mediaData is measured rather than
    // the zeroed placeholder. A silent file has no audio stream to draw.
    const probeOutput = media.mediaData as ProbeOutput | undefined;
    if (probeOutput && !probeOutput.audio) {
      this.logger.log(
        `Skipping waveform generation for ${media.id}: No audio stream detected`
      );
      return empty;
    }

    const chunks = planWaveformChunks(media.duration, input.config);
    if (chunks.length === 0) {
      this.logger.warn(
        `Skipping waveform generation for ${media.id}: duration is ${media.duration}`
      );
      return empty;
    }

    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    this.logger.log(
      `Generating ${chunks.length} waveform chunk(s) for ${media.duration}s ${media.mediaType} ${media.id}`
    );

    const waveformFileIds: string[] = [];
    let firstWaveformPath = '';

    for (const chunk of chunks) {
      const fileName = `waveform_${chunk.index}.png`;
      const waveformPath = FileResolver.resolveOutputFilePath(
        upload.WorkspaceRef,
        input.uploadId,
        fileName,
        this.storageService
      );
      if (chunk.index === 0) firstWaveformPath = waveformPath;

      try {
        // The executor reports what it actually drew — the trailing chunk is
        // narrower than the requested width, so persisting the request here
        // would misplace every consumer laying chunks end to end.
        const rendered = await this.waveformExecutor.execute(
          filePath,
          waveformPath,
          input.config,
          chunk
        );

        const storageKey = this.storageService.transcodeStorageKey(
          upload.WorkspaceRef,
          input.uploadId,
          FileType.WAVEFORM,
          fileName
        );

        const waveformFile = await this.pocketbaseService.uploadFile({
          localFilePath: waveformPath,
          fileName,
          fileType: FileType.WAVEFORM,
          fileSource: FileSource.POCKETBASE,
          storageKey,
          workspaceRef: upload.WorkspaceRef,
          uploadRef: input.uploadId,
          // Link the File back to its Media so it is removed with the Media.
          mediaRef: media.id,
          mimeType: WAVEFORM_MIME_TYPE,
          meta: {
            ...ingestMeta(TranscodeStepType.WAVEFORM),
            mimeType: WAVEFORM_MIME_TYPE,
            waveformConfig: {
              width: rendered.width,
              height: rendered.height,
              pixelsPerSecond: rendered.pixelsPerSecond,
              color: input.config.color,
              mono: input.config.mono,
              chunkIndex: chunk.index,
              startTime: rendered.startTime,
              duration: rendered.duration,
            },
            // Dimensions of the image itself, so a consumer can size it
            // without decoding.
            width: rendered.width,
            height: rendered.height,
            duration: rendered.duration,
          },
        });

        waveformFileIds.push(waveformFile.id);
      } finally {
        // Clean up local output file if using S3 (no-op in local mode), on
        // both success and failure so a stateless pod never accumulates disk.
        await this.storageService.cleanup(waveformPath);
      }
    }

    await this.pocketbaseService.updateMedia(media.id, {
      waveformFileRefs: waveformFileIds,
    });

    return {
      waveformPath: firstWaveformPath,
      waveformFileId: waveformFileIds[0],
      allWaveformFileIds: waveformFileIds,
    };
  }
}
