import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { DetectLabelsStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { ProcessorsConfigService } from '../../config/processors.config';
import {
  UploadToGcsStepProcessor,
  type UploadToGcsStepInput,
} from './upload-to-gcs-step.processor';
import {
  LabelDetectionStepProcessor,
  type LabelDetectionStepInput,
} from './label-detection-step.processor';
import {
  ObjectTrackingStepProcessor,
  type ObjectTrackingStepInput,
} from './object-tracking-step.processor';
import {
  FaceDetectionStepProcessor,
  type FaceDetectionStepInput,
} from './face-detection-step.processor';
import {
  PersonDetectionStepProcessor,
  type PersonDetectionStepInput,
} from './person-detection-step.processor';
import {
  SpeechTranscriptionStepProcessor,
  type SpeechTranscriptionStepInput,
} from './speech-transcription-step.processor';

import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { BaseFlowProcessor } from '@/queue/processors';

/**
 * Parent processor for detect_labels tasks
 * Orchestrates child step processors and aggregates results
 *
 * Key features:
 * - Allows partial success (one processor can fail while others succeed)
 * - UPLOAD_TO_GCS runs first to upload file to GCS
 * - Five new GCVI processors run in parallel (if enabled):
 *   - LABEL_DETECTION (labels + shot changes)
 *   - OBJECT_TRACKING (tracked objects with keyframes)
 *   - FACE_DETECTION (tracked faces with attributes)
 *   - PERSON_DETECTION (tracked persons with landmarks)
 *   - SPEECH_TRANSCRIPTION (speech-to-text)
 * - Each processor processes and writes its own data independently
 * - Task succeeds if at least one enabled processor succeeds
 */
@Processor(QUEUE_NAMES.LABELS)
export class DetectLabelsParentProcessor extends BaseFlowProcessor {
  protected readonly logger = new Logger(DetectLabelsParentProcessor.name);
  protected readonly pocketbaseService: PocketBaseService;

  constructor(
    @InjectQueue(QUEUE_NAMES.LABELS)
    private readonly labelsQueue: Queue,
    pocketbaseService: PocketBaseService,
    private readonly processorsConfigService: ProcessorsConfigService,
    private readonly uploadToGcsStepProcessor: UploadToGcsStepProcessor,
    // New GCVI processors
    private readonly labelDetectionStepProcessor: LabelDetectionStepProcessor,
    private readonly objectTrackingStepProcessor: ObjectTrackingStepProcessor,
    private readonly faceDetectionStepProcessor: FaceDetectionStepProcessor,
    private readonly personDetectionStepProcessor: PersonDetectionStepProcessor,
    private readonly speechTranscriptionStepProcessor: SpeechTranscriptionStepProcessor
  ) {
    super();
    this.pocketbaseService = pocketbaseService;
  }

  /**
   * Get the queue instance for accessing child jobs
   */
  protected getQueue(): Queue {
    return this.labelsQueue;
  }

  /**
   * Process parent job - orchestrates child steps and aggregates results
   *
   * Detect labels tasks allow partial success:
   * - Task succeeds if at least one enabled processor completes successfully
   * - Task fails only if all enabled processors fail
   * - Disabled processors are skipped and don't affect success/failure
   */
  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { taskId, stepResults } = job.data;

    this.logger.log(`Processing parent job for task ${taskId}`);

    // Task status is now managed by the base class event handlers
    // No need to manually update here as it will be set by onActive event

    // Wait for all children to complete
    // BullMQ automatically handles this - parent job only completes when all children are done
    const childrenValues = await job.getChildrenValues();

    this.logger.log(`All children completed for task ${taskId}`, {
      childrenCount: Object.keys(childrenValues).length,
    });

    // Aggregate step results from children
    const aggregatedResults: Record<string, StepResult> = { ...stepResults };

    // First, collect results from successfully completed children
    for (const [, childResult] of Object.entries(childrenValues)) {
      if (
        childResult &&
        typeof childResult === 'object' &&
        'stepType' in childResult
      ) {
        const result = childResult as StepResult;
        aggregatedResults[result.stepType] = result;
      }
    }

    // Then, check for failed child jobs that didn't return results
    // This handles cases where jobs fail after exhausting retries
    // We'll query the queue for jobs with this parent job ID
    try {
      // Get all jobs in the queue and filter for children of this parent
      // Note: This is a fallback - ideally getChildrenValues would include failed jobs
      const allJobs = await this.labelsQueue.getJobs(
        ['failed', 'completed'],
        0,
        -1
      );

      for (const childJob of allJobs) {
        const childData = childJob.data as StepJobData | undefined;
        if (!childData || !childData.stepType) continue;

        // Check if this is a child of the current parent job
        if (childData.parentJobId !== job.id) continue;

        // If we don't have a result for this step type and the job failed, create a failed result
        if (!aggregatedResults[childData.stepType]) {
          const jobState = await childJob.getState();

          if (jobState === 'failed') {
            const failedResult: StepResult = {
              stepType: childData.stepType,
              status: 'failed',
              error: childJob.failedReason || 'Job failed without reason',
              startedAt: childJob.timestamp
                ? new Date(childJob.timestamp).toISOString()
                : undefined,
              completedAt: childJob.finishedOn
                ? new Date(childJob.finishedOn).toISOString()
                : undefined,
            };
            aggregatedResults[childData.stepType] = failedResult;
            this.logger.warn(
              `Found failed child job for step ${childData.stepType} that wasn't in childrenValues`
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to check for failed child jobs: ${error instanceof Error ? error.message : String(error)}`
      );
      // Continue processing even if we can't check for failed jobs
    }

    // Cache step results in parent job data for retry scenarios
    // This allows failed steps to be retried without re-executing successful steps
    await job.updateData({
      ...job.data,
      stepResults: aggregatedResults,
    });

    this.logger.log(
      `Cached ${Object.keys(aggregatedResults).length} step results for task ${taskId}`
    );

    // Check which new processors succeeded
    const labelDetectionResult =
      aggregatedResults[DetectLabelsStepType.LABEL_DETECTION];
    const objectTrackingResult =
      aggregatedResults[DetectLabelsStepType.OBJECT_TRACKING];
    const faceDetectionResult =
      aggregatedResults[DetectLabelsStepType.FACE_DETECTION];
    const personDetectionResult =
      aggregatedResults[DetectLabelsStepType.PERSON_DETECTION];
    const speechTranscriptionResult =
      aggregatedResults[DetectLabelsStepType.SPEECH_TRANSCRIPTION];

    // Determine which processors succeeded
    const successfulProcessors: string[] = [];
    const failedProcessors: string[] = [];

    // Check new processors
    // For enabled processors, they should have a result. If not, mark as failed.
    if (this.processorsConfigService.enableLabelDetection) {
      if (labelDetectionResult?.status === 'completed') {
        successfulProcessors.push('LABEL_DETECTION');
      } else {
        // Processor is enabled but either failed or has no result
        failedProcessors.push('LABEL_DETECTION');
        if (!labelDetectionResult) {
          this.logger.warn(
            `LABEL_DETECTION is enabled but has no result - marking as failed`
          );
        }
      }
    }

    if (this.processorsConfigService.enableObjectTracking) {
      if (objectTrackingResult?.status === 'completed') {
        successfulProcessors.push('OBJECT_TRACKING');
      } else {
        failedProcessors.push('OBJECT_TRACKING');
        if (!objectTrackingResult) {
          this.logger.warn(
            `OBJECT_TRACKING is enabled but has no result - marking as failed`
          );
        }
      }
    }

    if (this.processorsConfigService.enableFaceDetection) {
      if (faceDetectionResult?.status === 'completed') {
        successfulProcessors.push('FACE_DETECTION');
      } else {
        failedProcessors.push('FACE_DETECTION');
        if (!faceDetectionResult) {
          this.logger.warn(
            `FACE_DETECTION is enabled but has no result - marking as failed`
          );
        }
      }
    }

    if (this.processorsConfigService.enablePersonDetection) {
      if (personDetectionResult?.status === 'completed') {
        successfulProcessors.push('PERSON_DETECTION');
      } else {
        failedProcessors.push('PERSON_DETECTION');
        if (!personDetectionResult) {
          this.logger.warn(
            `PERSON_DETECTION is enabled but has no result - marking as failed`
          );
        }
      }
    }

    if (this.processorsConfigService.enableSpeechTranscription) {
      if (speechTranscriptionResult?.status === 'completed') {
        successfulProcessors.push('SPEECH_TRANSCRIPTION');
      } else {
        failedProcessors.push('SPEECH_TRANSCRIPTION');
        if (!speechTranscriptionResult) {
          this.logger.warn(
            `SPEECH_TRANSCRIPTION is enabled but has no result - marking as failed`
          );
        }
      }
    }

    // Log results
    this.logger.log(`Detect labels results for task ${taskId}:`, {
      successful: successfulProcessors,
      failed: failedProcessors,
    });

    // Determine overall task status
    // Task succeeds if at least one processor succeeded
    if (successfulProcessors.length === 0) {
      // All enabled processors failed
      this.logger.error(
        `Task ${taskId} failed: all enabled processors failed`,
        {
          failedProcessors,
        }
      );
      // Base class will handle the task status update on failure
      throw new Error(
        `Detect labels task failed: all enabled processors failed (${failedProcessors.join(', ')})`
      );
    }

    // Task succeeded with at least one processor
    // Base class will handle the task status update on completion
    if (failedProcessors.length === 0) {
      this.logger.log(
        `Task ${taskId} completed successfully with all processors`,
        {
          successfulProcessors,
        }
      );
    } else {
      this.logger.log(
        `Task ${taskId} completed successfully with partial results`,
        {
          successfulProcessors,
          failedProcessors,
        }
      );
    }
  }

  /**
   * Process step job - dispatches to appropriate step processor
   */
  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input, parentJobId } = job.data;
    const startedAt = new Date();

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    // Check if this step has already been completed in a previous attempt
    // This allows retries to skip successful steps and only re-run failed ones
    if (parentJobId) {
      const parentJob = await this.labelsQueue.getJob(parentJobId);
      if (parentJob) {
        const parentData = parentJob.data as ParentJobData;
        const cachedResult = parentData.stepResults[stepType];

        if (cachedResult && cachedResult.status === 'completed') {
          this.logger.log(
            `Step ${stepType} already completed in previous attempt, using cached result`
          );
          return cachedResult;
        }
      }
    }

    try {
      let output: unknown;

      // Dispatch to appropriate step processor based on step type
      switch (stepType) {
        case DetectLabelsStepType.UPLOAD_TO_GCS:
          output = await this.uploadToGcsStepProcessor.process(
            input as UploadToGcsStepInput,
            job
          );
          break;

        // New GCVI processors
        case DetectLabelsStepType.LABEL_DETECTION:
          output = await this.labelDetectionStepProcessor.process(
            input as LabelDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.OBJECT_TRACKING:
          output = await this.objectTrackingStepProcessor.process(
            input as ObjectTrackingStepInput,
            job
          );
          break;

        case DetectLabelsStepType.FACE_DETECTION:
          output = await this.faceDetectionStepProcessor.process(
            input as FaceDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.PERSON_DETECTION:
          output = await this.personDetectionStepProcessor.process(
            input as PersonDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.SPEECH_TRANSCRIPTION:
          output = await this.speechTranscriptionStepProcessor.process(
            input as SpeechTranscriptionStepInput,
            job
          );
          break;
        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      // Create successful result
      const result: StepResult = {
        stepType,
        status: 'completed',
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      this.logger.log(`Step ${stepType} completed successfully`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Step ${stepType} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined
      );

      // Create failed result
      const result: StepResult = {
        stepType,
        status: 'failed',
        error: errorMessage,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      // For detect labels tasks, we allow partial success
      // Don't re-throw for new GCVI processor failures
      // Let the parent job handle the partial success logic
      if (
        stepType === DetectLabelsStepType.LABEL_DETECTION ||
        stepType === DetectLabelsStepType.OBJECT_TRACKING ||
        stepType === DetectLabelsStepType.FACE_DETECTION ||
        stepType === DetectLabelsStepType.PERSON_DETECTION ||
        stepType === DetectLabelsStepType.SPEECH_TRANSCRIPTION
      ) {
        this.logger.warn(
          `Step ${stepType} failed but allowing partial success`
        );
        return result;
      }

      // For processing steps, re-throw to let BullMQ handle retry logic
      throw error;
    }
  }
}
