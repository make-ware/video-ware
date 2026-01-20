/**
 * Labels Flow Builder
 * Builds BullMQ flow definitions for label detection operations
 */

import type { Task, DetectLabelsPayload } from '@project/shared';
import { DetectLabelsStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { LabelsFlowDefinition } from './types';

export class LabelsFlowBuilder {
  static buildFlow(task: Task): LabelsFlowDefinition {
    const payload = task.payload as DetectLabelsPayload;
    const { mediaId, fileRef } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    const version = 1;

    const flow: LabelsFlowDefinition = {
      name: 'parent',
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepResults: {},
      },
      children: [],
    };

    // UPLOAD_TO_GCS step (runs first)
    const uploadOptions = getStepJobOptions(DetectLabelsStepType.UPLOAD_TO_GCS);

    flow.children.push({
      name: DetectLabelsStepType.UPLOAD_TO_GCS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.UPLOAD_TO_GCS,
        parentJobId: '',
        input: {
          type: 'upload_to_gcs',
          mediaId,
          workspaceRef: task.WorkspaceRef,
          fileRef,
        },
      },
      opts: uploadOptions,
    });

    // LABEL_DETECTION step (depends on UPLOAD_TO_GCS)
    if (payload.config?.detectLabels !== false) {
      const labelDetectionOptions = getStepJobOptions(
        DetectLabelsStepType.LABEL_DETECTION
      );

      flow.children.push({
        name: DetectLabelsStepType.LABEL_DETECTION,
        queueName: QUEUE_NAMES.LABELS,
        data: {
          ...baseJobData,
          stepType: DetectLabelsStepType.LABEL_DETECTION,
          parentJobId: '',
          input: {
            type: 'label_detection',
            mediaId,
            workspaceRef: task.WorkspaceRef,
            taskRef: task.id,
            version,
            config: {
              videoConfidenceThreshold: payload.config?.confidenceThreshold,
            },
          },
        },
        opts: labelDetectionOptions,
        children: [
          {
            name: DetectLabelsStepType.UPLOAD_TO_GCS,
            queueName: QUEUE_NAMES.LABELS,
          },
        ],
      });
    }

    // OBJECT_TRACKING step (depends on UPLOAD_TO_GCS)
    if (payload.config?.detectObjects !== false) {
      const objectTrackingOptions = getStepJobOptions(
        DetectLabelsStepType.OBJECT_TRACKING
      );

      flow.children.push({
        name: DetectLabelsStepType.OBJECT_TRACKING,
        queueName: QUEUE_NAMES.LABELS,
        data: {
          ...baseJobData,
          stepType: DetectLabelsStepType.OBJECT_TRACKING,
          parentJobId: '',
          input: {
            type: 'object_tracking',
            mediaId,
            workspaceRef: task.WorkspaceRef,
            taskRef: task.id,
            version,
          },
        },
        opts: objectTrackingOptions,
        children: [
          {
            name: DetectLabelsStepType.UPLOAD_TO_GCS,
            queueName: QUEUE_NAMES.LABELS,
          },
        ],
      });
    }

    // FACE_DETECTION step (depends on UPLOAD_TO_GCS)
    if (payload.config?.detectFaces) {
      const faceDetectionOptions = getStepJobOptions(
        DetectLabelsStepType.FACE_DETECTION
      );

      flow.children.push({
        name: DetectLabelsStepType.FACE_DETECTION,
        queueName: QUEUE_NAMES.LABELS,
        data: {
          ...baseJobData,
          stepType: DetectLabelsStepType.FACE_DETECTION,
          parentJobId: '',
          input: {
            type: 'face_detection',
            mediaId,
            workspaceRef: task.WorkspaceRef,
            taskRef: task.id,
            version,
          },
        },
        opts: faceDetectionOptions,
        children: [
          {
            name: DetectLabelsStepType.UPLOAD_TO_GCS,
            queueName: QUEUE_NAMES.LABELS,
          },
        ],
      });
    }

    // PERSON_DETECTION step (depends on UPLOAD_TO_GCS)
    if (payload.config?.detectPersons) {
      const personDetectionOptions = getStepJobOptions(
        DetectLabelsStepType.PERSON_DETECTION
      );

      flow.children.push({
        name: DetectLabelsStepType.PERSON_DETECTION,
        queueName: QUEUE_NAMES.LABELS,
        data: {
          ...baseJobData,
          stepType: DetectLabelsStepType.PERSON_DETECTION,
          parentJobId: '',
          input: {
            type: 'person_detection',
            mediaId,
            workspaceRef: task.WorkspaceRef,
            taskRef: task.id,
            version,
          },
        },
        opts: personDetectionOptions,
        children: [
          {
            name: DetectLabelsStepType.UPLOAD_TO_GCS,
            queueName: QUEUE_NAMES.LABELS,
          },
        ],
      });
    }

    // SPEECH_TRANSCRIPTION step (depends on UPLOAD_TO_GCS)
    if (payload.config?.detectSpeech) {
      const speechTranscriptionOptions = getStepJobOptions(
        DetectLabelsStepType.SPEECH_TRANSCRIPTION
      );

      flow.children.push({
        name: DetectLabelsStepType.SPEECH_TRANSCRIPTION,
        queueName: QUEUE_NAMES.LABELS,
        data: {
          ...baseJobData,
          stepType: DetectLabelsStepType.SPEECH_TRANSCRIPTION,
          parentJobId: '',
          input: {
            type: 'speech_transcription',
            mediaId,
            workspaceRef: task.WorkspaceRef,
            taskRef: task.id,
            version,
          },
        },
        opts: speechTranscriptionOptions,
        children: [
          {
            name: DetectLabelsStepType.UPLOAD_TO_GCS,
            queueName: QUEUE_NAMES.LABELS,
          },
        ],
      });
    }
    return flow;
  }
}
