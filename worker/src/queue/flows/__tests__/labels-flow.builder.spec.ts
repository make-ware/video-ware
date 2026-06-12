import { describe, it, expect } from 'vitest';
import { LabelsFlowBuilder } from '../labels-flow.builder';
import type { EnabledLabelProcessors } from '../labels-flow.builder';
import { LABELS_FLOW_STEPS } from '@project/shared/jobs';
import { ProcessingProvider } from '@project/shared';
import type {
  Task,
  DetectLabelsPayload,
  DetectLabelsConfig,
} from '@project/shared';
import type { LabelsChildJobDefinition } from '../types';

const ALL_ENABLED: EnabledLabelProcessors = {
  labelDetection: true,
  objectTracking: true,
  faceDetection: true,
  personDetection: true,
  speechTranscription: true,
};

const NONE_ENABLED: EnabledLabelProcessors = {
  labelDetection: false,
  objectTracking: false,
  faceDetection: false,
  personDetection: false,
  speechTranscription: false,
};

const ALL_REQUESTED: DetectLabelsConfig = {
  confidenceThreshold: 0.5,
  detectObjects: true,
  detectLabels: true,
  detectFaces: true,
  detectPersons: true,
  detectSpeech: true,
};

function makeTask(config: DetectLabelsConfig): Task {
  const payload: DetectLabelsPayload = {
    mediaId: 'test-media-id',
    fileRef: 'test-file-ref',
    provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
    config,
  };

  return {
    id: 'test-task-id',
    WorkspaceRef: 'test-workspace-id',
    payload,
  } as Task;
}

function detectionChildren(
  flow: ReturnType<typeof LabelsFlowBuilder.buildFlow>
): LabelsChildJobDefinition[] {
  return flow.children as LabelsChildJobDefinition[];
}

describe('LabelsFlowBuilder - Flow Definition Compliance', () => {
  /**
   * This test ensures that the LabelsFlowBuilder implements all steps
   * defined in LABELS_FLOW_STEPS. This prevents us from forgetting to
   * add new steps to the flow builder.
   */
  it('should include all defined labels steps when everything is enabled', () => {
    const flow = LabelsFlowBuilder.buildFlow(
      makeTask(ALL_REQUESTED),
      ALL_ENABLED
    );

    // Flatten the tree: detection steps at the top, uploads nested below
    const builtStepTypes = new Set<string>();
    for (const child of detectionChildren(flow)) {
      builtStepTypes.add(child.data.stepType);
      for (const nested of child.children ?? []) {
        builtStepTypes.add((nested as LabelsChildJobDefinition).data.stepType);
      }
    }

    for (const expectedStep of Object.values(LABELS_FLOW_STEPS)) {
      expect(
        [...builtStepTypes],
        `Flow should include ${expectedStep} step`
      ).toContain(expectedStep);
    }

    // 5 detection steps at the top level
    expect(flow.children).toHaveLength(5);
  });

  it('should give every detection step its own real UPLOAD_TO_GCS child', () => {
    const flow = LabelsFlowBuilder.buildFlow(
      makeTask(ALL_REQUESTED),
      ALL_ENABLED
    );

    for (const step of detectionChildren(flow)) {
      expect(step.children).toHaveLength(1);
      const upload = step.children?.[0] as LabelsChildJobDefinition;

      // A REAL job definition, not a name-only dependency reference (BullMQ
      // has no such concept; a data-less child completes instantly and lets
      // the detection step race the actual upload).
      expect(upload.name).toBe(LABELS_FLOW_STEPS.UPLOAD_TO_GCS);
      expect(upload.data.stepType).toBe(LABELS_FLOW_STEPS.UPLOAD_TO_GCS);
      expect(upload.data.input).toMatchObject({
        type: 'upload_to_gcs',
        mediaId: 'test-media-id',
        fileRef: 'test-file-ref',
        workspaceRef: 'test-workspace-id',
      });
      // Upload failure must fail the detection step, not strand it
      expect(upload.opts?.failParentOnFailure).toBe(true);
    }
  });

  it('should allow partial success via ignoreDependencyOnFailure on detection steps', () => {
    const flow = LabelsFlowBuilder.buildFlow(
      makeTask(ALL_REQUESTED),
      ALL_ENABLED
    );

    for (const step of detectionChildren(flow)) {
      expect(step.opts?.ignoreDependencyOnFailure).toBe(true);
    }
  });

  it('should wire every child to the pre-generated parent job id', () => {
    const flow = LabelsFlowBuilder.buildFlow(
      makeTask(ALL_REQUESTED),
      ALL_ENABLED
    );

    expect(flow.opts?.jobId).toBeTruthy();

    for (const step of detectionChildren(flow)) {
      expect(step.data.parentJobId).toBe(flow.opts?.jobId);
      const upload = step.children?.[0] as LabelsChildJobDefinition;
      expect(upload.data.parentJobId).toBe(flow.opts?.jobId);
    }
  });

  it('should record enqueued detection steps in expectedSteps', () => {
    const flow = LabelsFlowBuilder.buildFlow(
      makeTask(ALL_REQUESTED),
      ALL_ENABLED
    );

    expect(flow.data.expectedSteps).toEqual([
      LABELS_FLOW_STEPS.LABEL_DETECTION,
      LABELS_FLOW_STEPS.OBJECT_TRACKING,
      LABELS_FLOW_STEPS.FACE_DETECTION,
      LABELS_FLOW_STEPS.PERSON_DETECTION,
      LABELS_FLOW_STEPS.SPEECH_TRANSCRIPTION,
    ]);
  });

  it('should omit steps disabled by env flags even when the payload requests them', () => {
    const flow = LabelsFlowBuilder.buildFlow(makeTask(ALL_REQUESTED), {
      ...ALL_ENABLED,
      faceDetection: false,
      speechTranscription: false,
    });

    const stepTypes = detectionChildren(flow).map((c) => c.data.stepType);
    expect(stepTypes).not.toContain(LABELS_FLOW_STEPS.FACE_DETECTION);
    expect(stepTypes).not.toContain(LABELS_FLOW_STEPS.SPEECH_TRANSCRIPTION);
    expect(flow.data.expectedSteps).toEqual(stepTypes);
  });

  it('should omit steps disabled by the payload even when env enables them', () => {
    const flow = LabelsFlowBuilder.buildFlow(
      makeTask({ detectLabels: false, detectObjects: false }),
      ALL_ENABLED
    );

    const stepTypes = detectionChildren(flow).map((c) => c.data.stepType);
    expect(stepTypes).not.toContain(LABELS_FLOW_STEPS.LABEL_DETECTION);
    expect(stepTypes).not.toContain(LABELS_FLOW_STEPS.OBJECT_TRACKING);
    expect(flow.data.expectedSteps).toEqual(stepTypes);
  });

  it('should default labels/objects on and faces/persons/speech off when payload is silent', () => {
    const flow = LabelsFlowBuilder.buildFlow(makeTask({}), ALL_ENABLED);

    const stepTypes = detectionChildren(flow).map((c) => c.data.stepType);
    expect(stepTypes).toEqual([
      LABELS_FLOW_STEPS.LABEL_DETECTION,
      LABELS_FLOW_STEPS.OBJECT_TRACKING,
    ]);
  });

  it('should build an empty flow (no upload) when no processors are enabled', () => {
    const flow = LabelsFlowBuilder.buildFlow(makeTask(ALL_REQUESTED), {
      ...NONE_ENABLED,
    });

    expect(flow.children).toHaveLength(0);
    expect(flow.data.expectedSteps).toEqual([]);
  });

  /**
   * Type-level test: This will cause a compile error if LABELS_FLOW_STEPS
   * is missing any step types that should be handled
   */
  it('should have type-safe step definitions', () => {
    const stepTypes: Record<string, string> = LABELS_FLOW_STEPS;

    expect(stepTypes.UPLOAD_TO_GCS).toBeDefined();
    expect(stepTypes.LABEL_DETECTION).toBeDefined();
    expect(stepTypes.OBJECT_TRACKING).toBeDefined();
    expect(stepTypes.FACE_DETECTION).toBeDefined();
    expect(stepTypes.PERSON_DETECTION).toBeDefined();
    expect(stepTypes.SPEECH_TRANSCRIPTION).toBeDefined();
  });
});
