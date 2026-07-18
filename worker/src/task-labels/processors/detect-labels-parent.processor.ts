import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import {
  DetectLabelsStepType,
  type StepType,
} from '../../queue/types/step.types';
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
  TextDetectionStepProcessor,
  type TextDetectionStepInput,
} from './text-detection-step.processor';
import {
  SpeechTranscriptionStepProcessor,
  type SpeechTranscriptionStepInput,
} from './speech-transcription-step.processor';
import {
  SpeakerTranscriptionStepProcessor,
  type SpeakerTranscriptionStepInput,
} from './speaker-transcription-step.processor';

import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { BaseFlowProcessor } from '@/queue/processors';
import { queueWorkerOptions } from '../../queue/worker-options';

/**
 * Parent processor for detect_labels tasks
 * Orchestrates child step processors and aggregates results
 *
 * Key features:
 * - Allows partial success (one processor can fail while others succeed)
 * - Each detection step owns an UPLOAD_TO_GCS child job (BullMQ flows are
 *   trees, so siblings can't share a dependency); the upload is idempotent
 *   and deduplicated, and guarantees the file is in GCS before detection runs
 * - Up to six GCVI processors run in parallel (if enabled):
 *   - LABEL_DETECTION (labels + shot changes)
 *   - OBJECT_TRACKING (tracked objects with keyframes)
 *   - FACE_DETECTION (tracked faces with attributes)
 *   - PERSON_DETECTION (tracked persons with landmarks)
 *   - TEXT_DETECTION (on-screen text OCR with per-frame boxes)
 *   - SPEECH_TRANSCRIPTION (speech-to-text)
 * - SPEAKER_TRANSCRIPTION (ElevenLabs diarized STT) runs alongside them but
 *   reads the media from app storage directly (no UPLOAD_TO_GCS child)
 * - Each processor processes and writes its own data independently
 * - The parent aggregates over the steps the flow builder enqueued
 *   (job.data.expectedSteps); task succeeds if at least one succeeds
 */
@Processor(QUEUE_NAMES.LABELS, queueWorkerOptions())
export class DetectLabelsParentProcessor extends BaseFlowProcessor {
  protected readonly logger = new Logger(DetectLabelsParentProcessor.name);
  protected readonly concurrencyConfigKey = 'concurrency.labels';
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
    private readonly textDetectionStepProcessor: TextDetectionStepProcessor,
    private readonly speechTranscriptionStepProcessor: SpeechTranscriptionStepProcessor,
    private readonly speakerTranscriptionStepProcessor: SpeakerTranscriptionStepProcessor
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

    // The flow builder records which detection steps it actually enqueued.
    // Aggregating over that list (instead of re-deriving from ENABLE_* env
    // vars) keeps the parent in agreement with the flow: a processor enabled
    // by env but excluded by the task payload is not expected to have results.
    // Jobs enqueued before expectedSteps existed fall back to the env flags.
    const expectedSteps =
      job.data.expectedSteps ?? this.expectedStepsFromConfig();

    // No detection steps were enqueued (processors disabled via ENABLE_* vars
    // or excluded by the task payload). Complete the task as a no-op.
    if (expectedSteps.length === 0) {
      this.logger.debug(
        `No detection steps expected for task ${taskId}; completing as no-op`
      );
      return;
    }

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

    // Determine which expected detection steps succeeded. A step with no
    // result at all (job lost/never ran) counts as failed.
    const successfulProcessors: string[] = [];
    const failedProcessors: string[] = [];

    for (const stepType of expectedSteps) {
      const result = aggregatedResults[stepType];
      if (result?.status === 'completed') {
        successfulProcessors.push(stepType);
      } else {
        failedProcessors.push(stepType);
        if (!result) {
          this.logger.warn(
            `Step ${stepType} was expected but has no result - marking as failed`
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
    const { stepType, input } = job.data;
    const parentJobId = this.resolveParentJobId(job);
    const startedAt = new Date();

    // Skip steps whose processor is disabled via ENABLE_* env vars. This is the
    // hard gate: a disabled step never reaches its step processor, so no GCVI
    // API call, DB write, or step-processor log is emitted. The parent
    // aggregation ignores disabled processors, so a no-op completed result is
    // safe and keeps the child job (and overall task) green.
    if (!this.isStepEnabled(stepType)) {
      this.logger.debug(`Step ${stepType} is disabled, skipping`);
      return {
        stepType,
        status: 'completed',
        output: { skipped: true, reason: 'processor disabled' },
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    // Check if this step has already been completed in a previous attempt
    // (or, for the duplicated UPLOAD_TO_GCS children, by a sibling branch).
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

        case DetectLabelsStepType.TEXT_DETECTION:
          output = await this.textDetectionStepProcessor.process(
            input as TextDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.SPEECH_TRANSCRIPTION:
          output = await this.speechTranscriptionStepProcessor.process(
            input as SpeechTranscriptionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.SPEAKER_TRANSCRIPTION:
          output = await this.speakerTranscriptionStepProcessor.process(
            input as SpeakerTranscriptionStepInput,
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
      this.logger.warn(`Step ${stepType} failed: ${errorMessage}`);

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
        stepType === DetectLabelsStepType.TEXT_DETECTION ||
        stepType === DetectLabelsStepType.SPEECH_TRANSCRIPTION ||
        stepType === DetectLabelsStepType.SPEAKER_TRANSCRIPTION
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

  /**
   * Legacy fallback for parent jobs enqueued before the flow builder recorded
   * `expectedSteps`: derive the expected detection steps from the ENABLE_*
   * env vars (the payload-level gating of those older flows is unknown here).
   */
  private expectedStepsFromConfig(): StepType[] {
    const cfg = this.processorsConfigService;
    const steps: StepType[] = [];
    if (cfg.enableLabelDetection) {
      steps.push(DetectLabelsStepType.LABEL_DETECTION);
    }
    if (cfg.enableObjectTracking) {
      steps.push(DetectLabelsStepType.OBJECT_TRACKING);
    }
    if (cfg.enableFaceDetection) {
      steps.push(DetectLabelsStepType.FACE_DETECTION);
    }
    if (cfg.enablePersonDetection) {
      steps.push(DetectLabelsStepType.PERSON_DETECTION);
    }
    if (cfg.enableTextDetection) {
      steps.push(DetectLabelsStepType.TEXT_DETECTION);
    }
    if (cfg.enableSpeechTranscription) {
      steps.push(DetectLabelsStepType.SPEECH_TRANSCRIPTION);
    }
    if (cfg.enableSpeakerTranscription) {
      steps.push(DetectLabelsStepType.SPEAKER_TRANSCRIPTION);
    }
    return steps;
  }

  /**
   * Determine whether a step should run based on the ENABLE_* env vars.
   * All GCVI processors are disabled by default; UPLOAD_TO_GCS only runs when
   * at least one of them is enabled (it has no purpose otherwise).
   */
  private isStepEnabled(stepType: StepType): boolean {
    const cfg = this.processorsConfigService;
    switch (stepType) {
      case DetectLabelsStepType.UPLOAD_TO_GCS:
        // Only GCVI processors consume the GCS temp upload.
        return cfg.hasEnabledGcviProcessors;
      case DetectLabelsStepType.LABEL_DETECTION:
        return cfg.enableLabelDetection;
      case DetectLabelsStepType.OBJECT_TRACKING:
        return cfg.enableObjectTracking;
      case DetectLabelsStepType.FACE_DETECTION:
        return cfg.enableFaceDetection;
      case DetectLabelsStepType.PERSON_DETECTION:
        return cfg.enablePersonDetection;
      case DetectLabelsStepType.TEXT_DETECTION:
        return cfg.enableTextDetection;
      case DetectLabelsStepType.SPEECH_TRANSCRIPTION:
        return cfg.enableSpeechTranscription;
      case DetectLabelsStepType.SPEAKER_TRANSCRIPTION:
        return cfg.enableSpeakerTranscription;
      default:
        // Non-label step types are unaffected by these flags.
        return true;
    }
  }
}
