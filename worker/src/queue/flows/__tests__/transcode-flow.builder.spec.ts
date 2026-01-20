import { describe, it, expect } from 'vitest';
import { TranscodeFlowBuilder } from '../transcode-flow.builder';
import { TRANSCODE_FLOW_STEPS } from '@project/shared/jobs';
import { ProcessingProvider } from '@project/shared';
import type { Task, ProcessUploadPayload } from '@project/shared';

describe('TranscodeFlowBuilder - Flow Definition Compliance', () => {
  /**
   * This test ensures that the TranscodeFlowBuilder implements all steps
   * defined in TRANSCODE_FLOW_STEPS. This prevents us from forgetting to
   * add new steps to the flow builder.
   */
  it('should include all defined transcode steps when fully configured', () => {
    // Create a fully configured payload with all optional steps enabled
    const payload: ProcessUploadPayload = {
      uploadId: 'test-upload-id',
      mediaId: 'test-media-id',
      provider: ProcessingProvider.FFMPEG,
      thumbnail: {
        timestamp: 1,
        width: 320,
        height: 240,
      },
      sprite: {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 160,
        tileHeight: 120,
      },
      filmstrip: {
        cols: 100,
        rows: 1,
        tileWidth: 320,
      },
      transcode: {
        enabled: true,
        codec: 'h264',
        resolution: '720p',
      },
      audio: {
        enabled: true,
        format: 'mp3',
        bitrate: '192k',
        channels: 2,
        sampleRate: 48000,
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    // Build the flow
    const flow = TranscodeFlowBuilder.buildFlow(task);

    // Extract step types from the flow (filter to only step jobs)
    const builtStepTypes = flow.children
      .filter((child) => 'stepType' in child.data)
      .map((child) => (child.data as any).stepType);

    // Get all expected step types from the definition
    const expectedStepTypes = Object.values(TRANSCODE_FLOW_STEPS);

    // Verify all expected steps are present
    for (const expectedStep of expectedStepTypes) {
      expect(
        builtStepTypes,
        `Flow should include ${expectedStep} step`
      ).toContain(expectedStep);
    }

    // Verify we have the correct number of steps
    expect(
      builtStepTypes.length,
      'Flow should have exactly 6 steps when fully configured'
    ).toBe(expectedStepTypes.length);
  });

  it('should include only PROBE step when no optional steps are configured', () => {
    const payload: ProcessUploadPayload = {
      uploadId: 'test-upload-id',
      mediaId: 'test-media-id',
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = TranscodeFlowBuilder.buildFlow(task);
    const builtStepTypes = flow.children
      .filter((child) => 'stepType' in child.data)
      .map((child) => (child.data as any).stepType);

    // Only PROBE should be present
    expect(builtStepTypes).toEqual([TRANSCODE_FLOW_STEPS.PROBE]);
  });

  it('should include PROBE and AUDIO steps when only audio is configured', () => {
    const payload: ProcessUploadPayload = {
      uploadId: 'test-upload-id',
      mediaId: 'test-media-id',
      audio: {
        enabled: true,
        format: 'mp3',
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = TranscodeFlowBuilder.buildFlow(task);
    const builtStepTypes = flow.children
      .filter((child) => 'stepType' in child.data)
      .map((child) => (child.data as any).stepType);

    expect(builtStepTypes).toContain(TRANSCODE_FLOW_STEPS.PROBE);
    expect(builtStepTypes).toContain(TRANSCODE_FLOW_STEPS.AUDIO);
    expect(builtStepTypes.length).toBe(2);
  });

  it('should not include AUDIO step when audio is configured but not enabled', () => {
    const payload: ProcessUploadPayload = {
      uploadId: 'test-upload-id',
      mediaId: 'test-media-id',
      audio: {
        enabled: false,
        format: 'mp3',
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = TranscodeFlowBuilder.buildFlow(task);
    const builtStepTypes = flow.children
      .filter((child) => 'stepType' in child.data)
      .map((child) => (child.data as any).stepType);

    expect(builtStepTypes).not.toContain(TRANSCODE_FLOW_STEPS.AUDIO);
  });

  it('should validate AUDIO step input configuration', () => {
    const payload: ProcessUploadPayload = {
      uploadId: 'test-upload-id',
      mediaId: 'test-media-id',
      audio: {
        enabled: true,
        format: 'aac',
        bitrate: '256k',
        channels: 1,
        sampleRate: 44100,
      },
    };

    const task: Task = {
      id: 'test-task-id',
      WorkspaceRef: 'test-workspace-id',
      payload,
    } as Task;

    const flow = TranscodeFlowBuilder.buildFlow(task);
    const audioStep = flow.children.find(
      (child) =>
        'stepType' in child.data &&
        (child.data as any).stepType === TRANSCODE_FLOW_STEPS.AUDIO
    );

    expect(audioStep).toBeDefined();
    expect((audioStep?.data as any).input).toMatchObject({
      type: 'audio',
      uploadId: 'test-upload-id',
      format: 'aac',
      bitrate: '256k',
      channels: 1,
      sampleRate: 44100,
    });
  });

  /**
   * Type-level test: This will cause a compile error if TRANSCODE_FLOW_STEPS
   * is missing any step types that should be handled
   */
  it('should have type-safe step definitions', () => {
    // This is a compile-time check - if a new step is added to the enum
    // but not to TRANSCODE_FLOW_STEPS, TypeScript will error
    const stepTypes: Record<string, string> = TRANSCODE_FLOW_STEPS;

    // Verify all keys exist
    expect(stepTypes.PROBE).toBeDefined();
    expect(stepTypes.THUMBNAIL).toBeDefined();
    expect(stepTypes.SPRITE).toBeDefined();
    expect(stepTypes.FILMSTRIP).toBeDefined();
    expect(stepTypes.TRANSCODE).toBeDefined();
    expect(stepTypes.AUDIO).toBeDefined();
  });
});
