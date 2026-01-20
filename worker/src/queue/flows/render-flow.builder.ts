/**
 * Render Flow Builder
 * Builds BullMQ flow definitions for render operations
 */

import type { Task, RenderTimelinePayload } from '@project/shared';
import { RenderStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { RenderFlowDefinition } from './types';

export class RenderFlowBuilder {
  /**
   * Build a render flow definition for RENDER_TIMELINE tasks
   * Builds a parent-child job hierarchy with steps: PREPARE, EXECUTE, FINALIZE
   */
  static buildFlow(task: Task): RenderFlowDefinition {
    const payload = task.payload as RenderTimelinePayload;
    const { timelineId, version, tracks, outputSettings } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      provider: payload.provider, // FFmpeg or Google Cloud
      attemptNumber: 0,
    };

    // Create parent job
    const flow: RenderFlowDefinition = {
      name: 'parent',
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepResults: {},
      },
      children: [],
    };

    // 1. PREPARE step (Resolve clips & ensure GCS availability)
    const prepareOptions = getStepJobOptions(RenderStepType.PREPARE);
    flow.children.push({
      name: RenderStepType.PREPARE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.PREPARE,
        parentJobId: '',
        input: {
          type: 'prepare',
          timelineId,
          tracks,
        },
      },
      opts: prepareOptions,
    });

    // 2. EXECUTE step (Run FFmpeg or GC Transcoder)
    // Fetches clipMediaMap independently - doesn't need data from PREPARE
    const executeOptions = getStepJobOptions(RenderStepType.EXECUTE);
    flow.children.push({
      name: RenderStepType.EXECUTE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.EXECUTE,
        parentJobId: '',
        input: {
          type: 'execute',
          timelineId,
          tracks,
          outputSettings,
        },
      },
      opts: executeOptions,
      children: [
        {
          name: RenderStepType.PREPARE,
          queueName: QUEUE_NAMES.RENDER,
        },
      ],
    });

    // 3. FINALIZE step (Probe, create records)
    // Uses deterministic path: ./data/renders/<taskId>/output.<format>
    // Doesn't need data from EXECUTE - path is computed from taskId
    const finalizeOptions = getStepJobOptions(RenderStepType.FINALIZE);
    flow.children.push({
      name: RenderStepType.FINALIZE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.FINALIZE,
        parentJobId: '',
        input: {
          type: 'finalize',
          timelineId,
          workspaceId: task.WorkspaceRef,
          version,
          format: outputSettings.format,
        },
      },
      opts: finalizeOptions,
      children: [
        {
          name: RenderStepType.EXECUTE,
          queueName: QUEUE_NAMES.RENDER,
        },
      ],
    });

    return flow;
  }
}
