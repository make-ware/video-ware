import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import {
  TranscodeStepType,
  type TaskTranscodeProbeStep,
  type TaskTranscodeThumbnailStep,
  type TaskTranscodeSpriteStep,
  type TaskTranscodeFilmstripStep,
  type TaskTranscodeTranscodeStep,
  type TaskTranscodeAudioStep,
} from '@project/shared/jobs';
import { type ProcessUploadPayload } from '@project/shared';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import { ProbeStepProcessor } from './probe-step.processor';
import { ThumbnailStepProcessor } from './thumbnail-step.processor';
import { SpriteStepProcessor } from './sprite-step.processor';
import { FilmstripStepProcessor } from './filmstrip-step.processor';
import { TranscodeStepProcessor } from './transcode-step.processor';
import { AudioStepProcessor } from './audio-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { BaseFlowProcessor } from '@/queue/processors';

/**
 * Parent processor for transcode tasks
 * Orchestrates independent step processors that write directly to the database
 */
@Processor(QUEUE_NAMES.TRANSCODE)
export class TranscodeParentProcessor extends BaseFlowProcessor {
  protected readonly logger = new Logger(TranscodeParentProcessor.name);
  protected readonly pocketbaseService: PocketBaseService;

  constructor(
    @InjectQueue(QUEUE_NAMES.TRANSCODE)
    private readonly transcodeQueue: Queue,
    pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService,
    private readonly probeStepProcessor: ProbeStepProcessor,
    private readonly thumbnailStepProcessor: ThumbnailStepProcessor,
    private readonly spriteStepProcessor: SpriteStepProcessor,
    private readonly filmstripStepProcessor: FilmstripStepProcessor,
    private readonly transcodeStepProcessor: TranscodeStepProcessor,
    private readonly audioStepProcessor: AudioStepProcessor
  ) {
    super();
    this.pocketbaseService = pocketbaseService;
  }

  /**
   * Get the queue instance for accessing child jobs
   */
  protected getQueue(): Queue {
    return this.transcodeQueue;
  }

  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { taskId } = job.data;

    this.logger.log(`Processing parent job for task ${taskId}`);

    // Task status is now managed by the base class event handlers
    // No need to manually update here as it will be set by onActive event

    // Wait for all children to complete
    // BullMQ automatically handles this - parent job only completes when all children are done
    const childrenValues = await job.getChildrenValues();

    this.logger.log(
      `All ${Object.keys(childrenValues).length} children completed for task ${taskId}`
    );

    // Check if any steps failed
    const failedSteps = Object.values(childrenValues).filter(
      (result: unknown) =>
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'failed'
    );

    if (failedSteps.length > 0) {
      // Base class will handle the task status update on failure
      this.logger.error(
        `Task ${taskId} has ${failedSteps.length} failed steps`
      );
      throw new Error(`Task failed with ${failedSteps.length} failed steps`);
    }

    // Update Media to active
    const task = await this.pocketbaseService.taskMutator.getById(taskId);
    if (task) {
      const payload = task.payload as ProcessUploadPayload;
      if (payload.mediaId) {
        await this.pocketbaseService.updateMedia(payload.mediaId, {
          isActive: true,
        });
        this.logger.log(`Set Media ${payload.mediaId} to active`);
      }
    }

    // Task succeeded - base class will handle the status update on completion
    this.logger.log(`Task ${taskId} completed successfully`);
  }

  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const startedAt = new Date();
    const { stepType, input } = job.data;

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    if (!input) {
      throw new Error(`Input is missing for step ${stepType}`);
    }

    try {
      let output: unknown;

      switch (stepType) {
        case TranscodeStepType.PROBE:
          output = await this.probeStepProcessor.process(
            input as TaskTranscodeProbeStep,
            job
          );
          break;

        case TranscodeStepType.THUMBNAIL:
          output = await this.thumbnailStepProcessor.process(
            input as TaskTranscodeThumbnailStep,
            job
          );
          break;

        case TranscodeStepType.SPRITE:
          output = await this.spriteStepProcessor.process(
            input as TaskTranscodeSpriteStep,
            job
          );
          break;

        case TranscodeStepType.FILMSTRIP:
          output = await this.filmstripStepProcessor.process(
            input as TaskTranscodeFilmstripStep,
            job
          );
          break;

        case TranscodeStepType.TRANSCODE:
          output = await this.transcodeStepProcessor.process(
            input as TaskTranscodeTranscodeStep,
            job
          );
          break;

        case TranscodeStepType.AUDIO:
          output = await this.audioStepProcessor.process(
            input as TaskTranscodeAudioStep,
            job
          );
          break;

        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      this.logger.log(`Step ${stepType} completed successfully`);

      return {
        stepType,
        status: 'completed',
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Step ${stepType} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined
      );

      throw error;
    }
  }
}
