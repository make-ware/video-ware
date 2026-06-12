/**
 * Render Flow Builder
 * Builds BullMQ flow definitions for render operations
 *
 * BullMQ flows are trees where every child must complete before its parent
 * runs (there is no way to reference a sibling job as a dependency), so the
 * strictly sequential PREPARE → EXECUTE → FINALIZE pipeline is expressed by
 * nesting — the deepest job runs first:
 *
 *   parent (aggregates results)
 *   └── FINALIZE
 *       └── EXECUTE
 *           └── PREPARE
 *
 * Every step is required, so each carries `failParentOnFailure`: a step that
 * exhausts its retries fails the rest of the chain (and ultimately the parent)
 * immediately instead of leaving the flow stuck in waiting-children.
 */

import { randomUUID } from 'node:crypto';
import type { Task, RenderTimelinePayload } from '@project/shared';
import { RenderStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { RenderFlowDefinition } from './types';

export class RenderFlowBuilder {
  /**
   * Build a render flow definition for RENDER_TIMELINE tasks
   */
  static buildFlow(task: Task): RenderFlowDefinition {
    const payload = task.payload as RenderTimelinePayload;
    const { timelineId, version, tracks, outputSettings } = payload;

    // Pre-generate the parent job id so every child can carry a correct
    // parentJobId pointing at the flow root (the chain means a step's direct
    // BullMQ parent is the next step, not the flow parent).
    const parentJobId = randomUUID();

    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      provider: payload.provider, // FFmpeg or Google Cloud
      attemptNumber: 0,
    };

    // 1. PREPARE step (Resolve clips & ensure availability) — runs first
    const prepareStep = {
      name: RenderStepType.PREPARE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.PREPARE,
        parentJobId,
        input: {
          type: 'prepare',
          timelineId,
          tracks,
        },
      },
      opts: {
        ...getStepJobOptions(RenderStepType.PREPARE),
        failParentOnFailure: true,
      },
    };

    // 2. EXECUTE step (Run FFmpeg or GC Transcoder) — after PREPARE
    const executeStep = {
      name: RenderStepType.EXECUTE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.EXECUTE,
        parentJobId,
        input: {
          type: 'execute',
          timelineId,
          tracks,
          outputSettings,
        },
      },
      opts: {
        ...getStepJobOptions(RenderStepType.EXECUTE),
        failParentOnFailure: true,
      },
      children: [prepareStep],
    };

    // 3. FINALIZE step (Probe, create records) — after EXECUTE
    // Uses deterministic path: ./data/renders/<taskId>/output.<format>
    const finalizeStep = {
      name: RenderStepType.FINALIZE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.FINALIZE,
        parentJobId,
        input: {
          type: 'finalize',
          timelineId,
          workspaceId: task.WorkspaceRef,
          version,
          format: outputSettings.format,
        },
      },
      opts: {
        ...getStepJobOptions(RenderStepType.FINALIZE),
        failParentOnFailure: true,
      },
      children: [executeStep],
    };

    return {
      name: 'parent',
      queueName: QUEUE_NAMES.RENDER,
      opts: { jobId: parentJobId },
      data: {
        ...baseJobData,
        stepResults: {},
        expectedSteps: [
          RenderStepType.PREPARE,
          RenderStepType.EXECUTE,
          RenderStepType.FINALIZE,
        ],
      },
      children: [finalizeStep],
    };
  }
}
