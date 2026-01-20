import { describe, it, expect } from 'vitest';
import { RenderFlowBuilder } from '../render-flow.builder';
import { RENDER_FLOW_STEPS } from '@project/shared/jobs';
import { ProcessingProvider } from '@project/shared';
import type { Task, RenderTimelinePayload } from '@project/shared';

describe('RenderFlowBuilder - Flow Definition Compliance', () => {
  /**
   * This test ensures that the RenderFlowBuilder implements all steps
   * defined in RENDER_FLOW_STEPS. This prevents us from forgetting to
   * add new steps to the flow builder.
   */
  it('should include all defined render steps', () => {
    const payload: RenderTimelinePayload = {
      timelineId: 'test-timeline-id',
      version: 1,
      tracks: [
        {
          id: 'track-1',
          type: 'video',
          segments: [
            {
              id: 'segment-1',
              assetId: 'asset-1',
              type: 'video',
              time: {
                start: 0,
                duration: 5,
                sourceStart: 0,
              },
            },
          ],
        },
      ],
      outputSettings: {
        codec: 'h264',
        format: 'mp4',
        resolution: '1920x1080',
      },
      provider: ProcessingProvider.FFMPEG,
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    // Build the flow
    const flow = RenderFlowBuilder.buildFlow(task);

    // Extract step types from the flow (filter to only step jobs)
    const builtStepTypes = flow.children
      .filter((child) => 'stepType' in child.data)
      .map((child) => (child.data as any).stepType);

    // Get all expected step types from the definition
    const expectedStepTypes = Object.values(RENDER_FLOW_STEPS);

    // Verify all expected steps are present
    for (const expectedStep of expectedStepTypes) {
      expect(
        builtStepTypes,
        `Flow should include ${expectedStep} step`
      ).toContain(expectedStep);
    }

    // Verify we have the correct number of steps (all are required)
    expect(
      builtStepTypes.length,
      'Flow should have exactly 3 steps (PREPARE, EXECUTE, FINALIZE)'
    ).toBe(expectedStepTypes.length);
  });

  it('should have correct step dependencies', () => {
    const payload: RenderTimelinePayload = {
      timelineId: 'test-timeline-id',
      version: 1,
      tracks: [],
      outputSettings: {
        codec: 'h264',
        format: 'mp4',
        resolution: '1920x1080',
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = RenderFlowBuilder.buildFlow(task);

    // EXECUTE should depend on PREPARE
    const executeStep = flow.children.find(
      (child) =>
        'stepType' in child.data &&
        (child.data as any).stepType === RENDER_FLOW_STEPS.EXECUTE
    );
    expect(executeStep?.children).toBeDefined();
    expect(executeStep?.children?.[0]?.name).toBe(RENDER_FLOW_STEPS.PREPARE);

    // FINALIZE should depend on EXECUTE
    const finalizeStep = flow.children.find(
      (child) =>
        'stepType' in child.data &&
        (child.data as any).stepType === RENDER_FLOW_STEPS.FINALIZE
    );
    expect(finalizeStep?.children).toBeDefined();
    expect(finalizeStep?.children?.[0]?.name).toBe(RENDER_FLOW_STEPS.EXECUTE);
  });

  /**
   * Type-level test: This will cause a compile error if RENDER_FLOW_STEPS
   * is missing any step types that should be handled
   */
  it('should have type-safe step definitions', () => {
    const stepTypes: Record<string, string> = RENDER_FLOW_STEPS;

    // Verify all keys exist
    expect(stepTypes.PREPARE).toBeDefined();
    expect(stepTypes.EXECUTE).toBeDefined();
    expect(stepTypes.FINALIZE).toBeDefined();
  });
});
