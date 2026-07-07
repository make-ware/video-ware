import { describe, it, expect } from 'vitest';
import { RenderFlowBuilder } from '../render-flow.builder';
import { RENDER_FLOW_STEPS } from '@project/shared/jobs';
import { ProcessingProvider } from '@project/shared';
import type { Task, RenderTimelinePayload } from '@project/shared';
import type { RenderChildJobDefinition } from '../types';

function makeTask(): Task {
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

  return {
    id: 'test-task-id',
    WorkspaceRef: 'test-workspace-id',
    payload,
  } as Task;
}

/** Flatten the nested chain into [FINALIZE, EXECUTE, PREPARE] order */
function chainSteps(
  flow: ReturnType<typeof RenderFlowBuilder.buildFlow>
): RenderChildJobDefinition[] {
  const steps: RenderChildJobDefinition[] = [];
  let current = flow.children[0] as RenderChildJobDefinition | undefined;
  while (current) {
    steps.push(current);
    current = current.children?.[0] as RenderChildJobDefinition | undefined;
  }
  return steps;
}

describe('RenderFlowBuilder - Flow Definition Compliance', () => {
  /**
   * This test ensures that the RenderFlowBuilder implements all steps
   * defined in RENDER_FLOW_STEPS. This prevents us from forgetting to
   * add new steps to the flow builder.
   */
  it('should include all defined render steps', () => {
    const flow = RenderFlowBuilder.buildFlow(makeTask());

    const builtStepTypes = chainSteps(flow).map((step) => step.data.stepType);

    const expectedStepTypes = Object.values(RENDER_FLOW_STEPS);

    for (const expectedStep of expectedStepTypes) {
      expect(
        builtStepTypes,
        `Flow should include ${expectedStep} step`
      ).toContain(expectedStep);
    }

    expect(
      builtStepTypes.length,
      'Flow should have exactly 3 steps (PREPARE, EXECUTE, FINALIZE)'
    ).toBe(expectedStepTypes.length);
  });

  it('should nest steps as a real FINALIZE → EXECUTE → PREPARE chain', () => {
    const flow = RenderFlowBuilder.buildFlow(makeTask());

    // BullMQ runs the deepest child first, so execution order is
    // PREPARE → EXECUTE → FINALIZE → parent.
    const [finalize, execute, prepare] = chainSteps(flow);

    expect(flow.children).toHaveLength(1);
    expect(finalize?.data.stepType).toBe(RENDER_FLOW_STEPS.FINALIZE);
    expect(execute?.data.stepType).toBe(RENDER_FLOW_STEPS.EXECUTE);
    expect(prepare?.data.stepType).toBe(RENDER_FLOW_STEPS.PREPARE);
    expect(prepare?.children).toBeUndefined();

    // Each step is a REAL job definition with data (a name-only "reference"
    // child would complete instantly and let steps race each other).
    for (const step of [finalize, execute, prepare]) {
      expect(step?.data.input).toBeDefined();
    }
  });

  it('should fail the chain (and parent) when any step fails', () => {
    const flow = RenderFlowBuilder.buildFlow(makeTask());

    for (const step of chainSteps(flow)) {
      expect(step.opts?.failParentOnFailure).toBe(true);
    }
  });

  it('should attempt every step (and the parent) exactly once', () => {
    const flow = RenderFlowBuilder.buildFlow(makeTask());

    // Renders that crash tend to crash again on retry, so the whole flow is
    // single-attempt: no step or parent may be retried.
    expect(flow.opts?.attempts).toBe(1);
    for (const step of chainSteps(flow)) {
      expect(step.opts?.attempts).toBe(1);
    }
  });

  it('should wire every step to the pre-generated parent job id', () => {
    const flow = RenderFlowBuilder.buildFlow(makeTask());

    expect(flow.opts?.jobId).toBeTruthy();
    for (const step of chainSteps(flow)) {
      expect(step.data.parentJobId).toBe(flow.opts?.jobId);
    }
  });

  /**
   * Type-level test: This will cause a compile error if RENDER_FLOW_STEPS
   * is missing any step types that should be handled
   */
  it('should have type-safe step definitions', () => {
    const stepTypes: Record<string, string> = RENDER_FLOW_STEPS;

    expect(stepTypes.PREPARE).toBeDefined();
    expect(stepTypes.EXECUTE).toBeDefined();
    expect(stepTypes.FINALIZE).toBeDefined();
  });
});
