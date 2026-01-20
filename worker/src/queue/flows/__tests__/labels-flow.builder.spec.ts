import { describe, it, expect } from 'vitest';
import { LabelsFlowBuilder } from '../labels-flow.builder';
import { LABELS_FLOW_STEPS } from '@project/shared/jobs';
import { ProcessingProvider } from '@project/shared';
import type { Task, DetectLabelsPayload } from '@project/shared';

describe('LabelsFlowBuilder - Flow Definition Compliance', () => {
  /**
   * This test ensures that the LabelsFlowBuilder implements all steps
   * defined in LABELS_FLOW_STEPS. This prevents us from forgetting to
   * add new steps to the flow builder.
   */
  it('should include all defined labels steps', () => {
    const payload: DetectLabelsPayload = {
      mediaId: 'test-media-id',
      fileRef: 'test-file-ref',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      config: {
        confidenceThreshold: 0.5,
        detectObjects: true,
        detectLabels: true,
        detectFaces: true,
        detectPersons: true,
        detectSpeech: true,
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    // Build the flow
    const flow = LabelsFlowBuilder.buildFlow(task);

    // Extract step types from the flow (filter to only step jobs)
    const builtStepTypes = flow.children
      .filter((child) => 'stepType' in child.data)
      .map((child) => (child.data as any).stepType);

    // Get all expected step types from the definition
    const expectedStepTypes = Object.values(LABELS_FLOW_STEPS);

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
      'Flow should have exactly 6 steps (UPLOAD_TO_GCS + 5 detection steps)'
    ).toBe(expectedStepTypes.length);
  });

  it('should have all detection steps depend on UPLOAD_TO_GCS', () => {
    const payload: DetectLabelsPayload = {
      mediaId: 'test-media-id',
      fileRef: 'test-file-ref',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      config: {
        detectLabels: true,
        detectObjects: true,
        detectFaces: true,
        detectPersons: true,
        detectSpeech: true,
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = LabelsFlowBuilder.buildFlow(task);

    // All detection steps should depend on UPLOAD_TO_GCS
    const detectionSteps = [
      LABELS_FLOW_STEPS.LABEL_DETECTION,
      LABELS_FLOW_STEPS.OBJECT_TRACKING,
      LABELS_FLOW_STEPS.FACE_DETECTION,
      LABELS_FLOW_STEPS.PERSON_DETECTION,
      LABELS_FLOW_STEPS.SPEECH_TRANSCRIPTION,
    ];

    for (const stepType of detectionSteps) {
      const step = flow.children.find(
        (child) =>
          'stepType' in child.data && (child.data as any).stepType === stepType
      );
      expect(step?.children).toBeDefined();
      expect(step?.children?.[0]?.name).toBe(LABELS_FLOW_STEPS.UPLOAD_TO_GCS);
    }
  });

  it('should have UPLOAD_TO_GCS as an independent step', () => {
    const payload: DetectLabelsPayload = {
      mediaId: 'test-media-id',
      fileRef: 'test-file-ref',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      config: {},
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = LabelsFlowBuilder.buildFlow(task);

    const uploadStep = flow.children.find(
      (child) =>
        'stepType' in child.data &&
        (child.data as any).stepType === LABELS_FLOW_STEPS.UPLOAD_TO_GCS
    );

    // UPLOAD_TO_GCS should not have dependencies
    expect(uploadStep?.children).toBeUndefined();
  });

  /**
   * Type-level test: This will cause a compile error if LABELS_FLOW_STEPS
   * is missing any step types that should be handled
   */
  it('should have type-safe step definitions', () => {
    const stepTypes: Record<string, string> = LABELS_FLOW_STEPS;

    // Verify all keys exist
    expect(stepTypes.UPLOAD_TO_GCS).toBeDefined();
    expect(stepTypes.LABEL_DETECTION).toBeDefined();
    expect(stepTypes.OBJECT_TRACKING).toBeDefined();
    expect(stepTypes.FACE_DETECTION).toBeDefined();
    expect(stepTypes.PERSON_DETECTION).toBeDefined();
    expect(stepTypes.SPEECH_TRANSCRIPTION).toBeDefined();
  });
});
