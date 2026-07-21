/**
 * Labels Flow Builder
 * Builds BullMQ flow definitions for label detection operations
 *
 * BullMQ flows are trees where every child must complete before its parent
 * runs. There is no way to reference an existing job as a dependency, so each
 * detection step gets its OWN real UPLOAD_TO_GCS child job. The upload step is
 * idempotent (deterministic GCS path + existence check) and the step processor
 * deduplicates concurrent uploads in-process, so duplicate children cost one
 * existence check each — and the detection step is guaranteed to only start
 * once the file is actually in GCS.
 *
 * Resulting tree (children run before parents):
 *
 *   parent (aggregates results)
 *   ├── LABEL_DETECTION       ── UPLOAD_TO_GCS
 *   ├── OBJECT_TRACKING       ── UPLOAD_TO_GCS
 *   ├── FACE_DETECTION        ── UPLOAD_TO_GCS
 *   ├── PERSON_DETECTION      ── UPLOAD_TO_GCS
 *   ├── TEXT_DETECTION        ── UPLOAD_TO_GCS
 *   ├── SPEECH_TRANSCRIPTION  ── UPLOAD_TO_GCS
 *   └── SPEAKER_TRANSCRIPTION            (ElevenLabs; reads app storage, no GCS)
 *
 * A detection step is added only when its deployment-level ENABLE_* flag is on
 * AND the task payload requests it. The steps actually added are recorded in
 * the parent's `expectedSteps`, which the parent processor aggregates over —
 * the builder is the single source of truth for what must produce results.
 */

import { randomUUID } from 'node:crypto';
import type { Task, DetectLabelsPayload } from '@project/shared';
import { DetectLabelsStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { LabelsChildJobDefinition, LabelsFlowDefinition } from './types';

/**
 * Deployment-level processor enablement (from ENABLE_* env vars).
 * Passed in by the caller so the builder stays a pure function.
 */
export interface EnabledLabelProcessors {
  labelDetection: boolean;
  objectTracking: boolean;
  faceDetection: boolean;
  personDetection: boolean;
  textDetection: boolean;
  speechTranscription: boolean;
  speakerTranscription: boolean;
}

export class LabelsFlowBuilder {
  static buildFlow(
    task: Task,
    enabled: EnabledLabelProcessors
  ): LabelsFlowDefinition {
    const payload = task.payload as DetectLabelsPayload;
    const { mediaId, fileRef } = payload;

    // Pre-generate the parent job id so every child can carry a correct
    // parentJobId (used for step-result caching and progress updates).
    const parentJobId = randomUUID();

    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    const version = 1;

    const buildUploadChild = (): LabelsChildJobDefinition => ({
      name: DetectLabelsStepType.UPLOAD_TO_GCS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.UPLOAD_TO_GCS,
        parentJobId,
        input: {
          type: 'upload_to_gcs',
          mediaId,
          workspaceRef: task.WorkspaceRef,
          fileRef,
        },
      },
      opts: {
        ...getStepJobOptions(DetectLabelsStepType.UPLOAD_TO_GCS),
        // A detection step is useless without its upload; fail it immediately
        // instead of leaving it stuck in waiting-children forever.
        failParentOnFailure: true,
      },
    });

    const detectionInputBase = {
      mediaId,
      workspaceRef: task.WorkspaceRef,
      taskRef: task.id,
      version,
    };

    // Effective gating: ENABLE_* env flag AND payload config. Labels/objects
    // default on when the payload is silent; faces/persons/text/speech/
    // speakers default off. GCVI steps need the file in GCS first; speaker
    // transcription (ElevenLabs) reads from app storage and skips the upload.
    const detectionSteps: Array<{
      stepType: DetectLabelsStepType;
      enabled: boolean;
      needsGcsUpload: boolean;
      input: Record<string, unknown>;
    }> = [
      {
        stepType: DetectLabelsStepType.LABEL_DETECTION,
        enabled:
          enabled.labelDetection && payload.config?.detectLabels !== false,
        needsGcsUpload: true,
        input: {
          type: 'label_detection',
          ...detectionInputBase,
          config: {
            videoConfidenceThreshold: payload.config?.confidenceThreshold,
          },
        },
      },
      {
        stepType: DetectLabelsStepType.OBJECT_TRACKING,
        enabled:
          enabled.objectTracking && payload.config?.detectObjects !== false,
        needsGcsUpload: true,
        input: { type: 'object_tracking', ...detectionInputBase },
      },
      {
        stepType: DetectLabelsStepType.FACE_DETECTION,
        enabled: enabled.faceDetection && payload.config?.detectFaces === true,
        needsGcsUpload: true,
        // Explicitly request the enhanced attribute data (emotion/headwear/
        // looking-at-camera likelihoods) rather than leaning on the executor's
        // implicit default, so the intent is visible at the flow level.
        input: {
          type: 'face_detection',
          ...detectionInputBase,
          config: { includeBoundingBoxes: true, includeAttributes: true },
        },
      },
      {
        stepType: DetectLabelsStepType.PERSON_DETECTION,
        enabled:
          enabled.personDetection && payload.config?.detectPersons === true,
        needsGcsUpload: true,
        input: { type: 'person_detection', ...detectionInputBase },
      },
      {
        stepType: DetectLabelsStepType.TEXT_DETECTION,
        enabled: enabled.textDetection && payload.config?.detectText === true,
        needsGcsUpload: true,
        input: { type: 'text_detection', ...detectionInputBase },
      },
      {
        stepType: DetectLabelsStepType.SPEECH_TRANSCRIPTION,
        enabled:
          enabled.speechTranscription && payload.config?.detectSpeech === true,
        needsGcsUpload: true,
        input: { type: 'speech_transcription', ...detectionInputBase },
      },
      {
        stepType: DetectLabelsStepType.SPEAKER_TRANSCRIPTION,
        enabled:
          enabled.speakerTranscription &&
          payload.config?.detectSpeakers === true,
        needsGcsUpload: false,
        // The step streams the file to ElevenLabs itself, so it carries the
        // storage fileRef the GCVI steps leave to their upload child.
        input: {
          type: 'speaker_transcription',
          ...detectionInputBase,
          fileRef,
        },
      },
    ];

    const children: LabelsChildJobDefinition[] = detectionSteps
      .filter((step) => step.enabled)
      .map((step) => ({
        name: step.stepType,
        queueName: QUEUE_NAMES.LABELS,
        data: {
          ...baseJobData,
          stepType: step.stepType,
          parentJobId,
          input: step.input,
        },
        opts: {
          ...getStepJobOptions(step.stepType),
          // Detect labels allows partial success: a failed detection step must
          // not block the parent from aggregating the other steps' results.
          ignoreDependencyOnFailure: true,
        },
        children: step.needsGcsUpload ? [buildUploadChild()] : [],
      }));

    return {
      name: 'parent',
      queueName: QUEUE_NAMES.LABELS,
      opts: { jobId: parentJobId },
      data: {
        ...baseJobData,
        stepResults: {},
        expectedSteps: children.map((child) => child.data.stepType),
      },
      children,
    };
  }
}
