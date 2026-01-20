/**
 * Transcode Flow Builder
 * Builds BullMQ flow definitions for transcode operations
 */

import type { Task, ProcessUploadPayload } from '@project/shared';
import { ProcessingProvider } from '@project/shared';
import { TranscodeStepType } from '@project/shared/jobs';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { TranscodeFlowDefinition } from './types';

export class TranscodeFlowBuilder {
  /**
   * Build a transcode flow definition for PROCESS_UPLOAD tasks
   * Builds a parent-child job hierarchy with steps: PROBE, THUMBNAIL, SPRITE, FILMSTRIP, TRANSCODE, AUDIO
   */
  static buildFlow(task: Task): TranscodeFlowDefinition {
    const payload = task.payload as ProcessUploadPayload;
    const { uploadId, mediaId } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      uploadId,
      mediaId,
    };

    // Create parent job with children
    const flow: TranscodeFlowDefinition = {
      name: 'parent',
      queueName: QUEUE_NAMES.TRANSCODE,
      data: {
        ...baseJobData,
        stepResults: {},
      },
      children: [],
    };

    // PROBE step (always required)
    const probeOptions = getStepJobOptions(TranscodeStepType.PROBE);
    flow.children.push({
      name: TranscodeStepType.PROBE,
      queueName: QUEUE_NAMES.TRANSCODE,
      data: {
        ...baseJobData,
        stepType: TranscodeStepType.PROBE,
        parentJobId: '', // Will be set by BullMQ
        input: {
          type: 'probe',
          uploadId,
          mediaId,
          filePath: '', // Will be resolved by processor
        },
      },
      opts: probeOptions,
    });

    // THUMBNAIL step (if configured)
    if (payload.thumbnail) {
      const thumbnailOptions = getStepJobOptions(TranscodeStepType.THUMBNAIL);
      flow.children.push({
        name: TranscodeStepType.THUMBNAIL,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.THUMBNAIL,
          parentJobId: '',
          input: {
            type: 'thumbnail',
            uploadId,
            mediaId,
            filePath: '', // Will be resolved by processor
            config: payload.thumbnail,
          },
        },
        opts: thumbnailOptions,
      });
    }

    // SPRITE step (if configured)
    if (payload.sprite) {
      const spriteOptions = getStepJobOptions(TranscodeStepType.SPRITE);
      flow.children.push({
        name: TranscodeStepType.SPRITE,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.SPRITE,
          parentJobId: '',
          input: {
            type: 'sprite',
            uploadId,
            mediaId,
            filePath: '', // Will be resolved by processor
            config: payload.sprite,
          },
        },
        opts: spriteOptions,
      });
    }

    // FILMSTRIP step (if configured)
    if (payload.filmstrip) {
      const filmstripOptions = getStepJobOptions(TranscodeStepType.FILMSTRIP);
      flow.children.push({
        name: TranscodeStepType.FILMSTRIP,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.FILMSTRIP,
          parentJobId: '',
          input: {
            type: 'filmstrip',
            uploadId,
            mediaId,
            filePath: '', // Will be resolved by processor
            config: payload.filmstrip,
          },
        },
        opts: filmstripOptions,
      });
    }

    // TRANSCODE step (if enabled)
    if (payload.transcode?.enabled) {
      const transcodeOptions = getStepJobOptions(TranscodeStepType.TRANSCODE);
      flow.children.push({
        name: TranscodeStepType.TRANSCODE,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.TRANSCODE,
          parentJobId: '',
          input: {
            type: 'transcode',
            uploadId,
            mediaId,
            filePath: '', // Will be resolved by processor
            provider: payload.provider || ProcessingProvider.FFMPEG,
            config: payload.transcode,
          },
        },
        opts: transcodeOptions,
      });
    }

    // AUDIO step (if enabled)
    if (payload.audio?.enabled) {
      const audioOptions = getStepJobOptions(TranscodeStepType.AUDIO);
      flow.children.push({
        name: TranscodeStepType.AUDIO,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.AUDIO,
          parentJobId: '',
          input: {
            type: 'audio',
            uploadId,
            mediaId,
            filePath: '', // Will be resolved by processor
            format: payload.audio.format,
            bitrate: payload.audio.bitrate,
            channels: payload.audio.channels,
            sampleRate: payload.audio.sampleRate,
          },
        },
        opts: audioOptions,
      });
    }

    return flow;
  }
}
