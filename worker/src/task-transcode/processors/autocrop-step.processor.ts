import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegAutoCropExecutor, FFmpegProbeExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type {
  TaskTranscodeAutoCropStep,
  TaskTranscodeAutoCropStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import {
  MediaType,
  cropBoxAgreement,
  cropBoxTolerance,
  cropBoxToRect,
  decideAutoCrop,
  mediaDisplayDimensions,
  sanitizeCropRect,
  unionCropBoxes,
  usableCropBoxes,
  type CropSuggestion,
  type MediaInput,
} from '@project/shared';

/**
 * Processor for the AUTOCROP step.
 *
 * Runs ffmpeg `cropdetect` over a few sample windows, aggregates the boxes
 * into one recommendation, and writes it to `Media.cropSuggestion` — always,
 * applied or not, so the column explains the media's crop. When the
 * recommendation clears the thresholds AND the detector owns `Media.crop`
 * (nothing stored, a full-frame no-op, or still exactly what a previous run
 * applied), it is written to `Media.crop` too.
 *
 * What it deliberately does NOT do is bake the crop into any generated file.
 * `Media.crop` is resolved at flatten time by the renderer (see
 * shared/src/utils/crop.ts), so cropping the proxy or the thumbnails here
 * would apply the same trim a second time.
 */
@Injectable()
export class AutoCropStepProcessor extends BaseStepProcessor<
  TaskTranscodeAutoCropStep,
  TaskTranscodeAutoCropStepOutput
> {
  protected readonly logger = new Logger(AutoCropStepProcessor.name);

  constructor(
    private readonly autoCropExecutor: FFmpegAutoCropExecutor,
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: TaskTranscodeAutoCropStep,
    _job: Job<StepJobData>
  ): Promise<TaskTranscodeAutoCropStepOutput> {
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (!media) {
      throw new Error(`Media not found for upload ${input.uploadId}`);
    }

    // Only video has borders to detect: audio has no frame at all, and a
    // still's single frame gives cropdetect no way to tell a black border
    // from a deliberately dark composition.
    if (
      media.mediaType === MediaType.IMAGE ||
      media.mediaType === MediaType.AUDIO
    ) {
      this.logger.debug(
        `Skipping crop detection for ${media.mediaType} media: ${media.id}`
      );
      return { applied: false };
    }

    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Probe here rather than reading Media.mediaData so the step stands on
    // its own: cropdetect reports DISPLAY pixels (ffmpeg autorotate runs
    // ahead of the filtergraph), and those must be normalized against the
    // display frame, not the coded one.
    const { probeOutput } = await this.probeExecutor.execute(filePath);
    const { width: displayWidth, height: displayHeight } =
      mediaDisplayDimensions({ mediaData: probeOutput });

    if (displayWidth <= 0 || displayHeight <= 0) {
      this.logger.warn(
        `Skipping crop detection for media ${media.id}: unknown display dimensions`
      );
      return { applied: false };
    }

    const { boxes, attempted, limit } = await this.autoCropExecutor.execute(
      filePath,
      {
        limit: input.config.limit,
        samples: input.config.samples,
        sampleDuration: input.config.sampleDuration,
        sampleFps: input.config.sampleFps,
        durationSec: probeOutput.duration,
      }
    );

    // An all-black window bounds nothing, so it is not a sample — counting it
    // would overstate `samples` and drag `agreement` down for a detection it
    // never contributed to.
    const usable = usableCropBoxes(boxes);
    const union = unionCropBoxes(usable);
    const rect = union
      ? cropBoxToRect(union, displayWidth, displayHeight)
      : undefined;
    if (!union || !rect) {
      // Nothing usable came back (every window black, or a degenerate box).
      // Leave both columns alone — an absent suggestion is honest about
      // having learned nothing, where a full-frame one would not be.
      this.logger.warn(
        `Crop detection produced no usable box for media ${media.id} ` +
          `(${usable.length}/${attempted} windows usable)`
      );
      return { applied: false };
    }

    const decision = decideAutoCrop({
      rect,
      existingCrop: sanitizeCropRect(media.crop),
      previous: media.cropSuggestion,
      thresholds: {
        ...(input.config.minTrimFraction !== undefined && {
          minTrimFraction: input.config.minTrimFraction,
        }),
        ...(input.config.minAreaFraction !== undefined && {
          minAreaFraction: input.config.minAreaFraction,
        }),
      },
    });

    const suggestion: CropSuggestion = {
      rect,
      pixels: union,
      displayWidth,
      displayHeight,
      samples: usable.length,
      attempted,
      agreement: cropBoxAgreement(
        usable,
        union,
        cropBoxTolerance(displayWidth, displayHeight)
      ),
      applied: decision.applied,
      ...(decision.skipReason && { skipReason: decision.skipReason }),
      limit,
      detectedAt: new Date().toISOString(),
    };

    const update: Partial<MediaInput> = {
      cropSuggestion: suggestion,
      ...(decision.crop && { crop: decision.crop }),
    };
    await this.pocketbaseService.updateMedia(media.id, update);

    if (decision.applied) {
      this.logger.log(
        `Applied detected crop to media ${media.id}: ` +
          `${union.width}x${union.height}+${union.x}+${union.y} of ` +
          `${displayWidth}x${displayHeight} ` +
          `(${usable.length}/${attempted} windows, agreement ${suggestion.agreement.toFixed(2)})`
      );
    } else {
      this.logger.debug(
        `Detected crop not applied to media ${media.id}: ${decision.skipReason}`
      );
    }

    return { cropSuggestion: suggestion, applied: decision.applied };
  }
}
