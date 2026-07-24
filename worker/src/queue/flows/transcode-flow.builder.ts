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

/**
 * Child step priorities (BullMQ: 0 = highest, larger = lower). Transcode
 * children are siblings with no `dependsOn`, so ordering is expressed via
 * priority. With the transcode queue's default concurrency of 1 this makes the
 * order deterministic: PROBE first (writes Media.mediaData/hasAudio that AUDIO
 * reads — also closes a latent read-before-write race), then AUDIO so the
 * audio-only proxy (Media.audioFileRef) lands within seconds, ahead of the
 * heavy video encode. Downstream speaker transcription waits for that proxy,
 * so producing it early keeps its ElevenLabs upload small. (At concurrency > 1
 * priority is best-effort ordering, but strictly no worse than today's
 * unordered fan-out.)
 */
const STEP_PRIORITY: Record<string, number> = {
  [TranscodeStepType.PROBE]: 1,
  [TranscodeStepType.AUDIO]: 2,
  [TranscodeStepType.THUMBNAIL]: 3,
  [TranscodeStepType.SPRITE]: 3,
  [TranscodeStepType.FILMSTRIP]: 3,
  [TranscodeStepType.TRANSCODE]: 4,
};

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
      opts: {
        ...probeOptions,
        priority: STEP_PRIORITY[TranscodeStepType.PROBE],
      },
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
        opts: {
          ...thumbnailOptions,
          priority: STEP_PRIORITY[TranscodeStepType.THUMBNAIL],
        },
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
        opts: {
          ...spriteOptions,
          priority: STEP_PRIORITY[TranscodeStepType.SPRITE],
        },
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
        opts: {
          ...filmstripOptions,
          priority: STEP_PRIORITY[TranscodeStepType.FILMSTRIP],
        },
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
        opts: {
          ...transcodeOptions,
          priority: STEP_PRIORITY[TranscodeStepType.TRANSCODE],
        },
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
        opts: {
          ...audioOptions,
          priority: STEP_PRIORITY[TranscodeStepType.AUDIO],
        },
      });
    }

    return flow;
  }
}
