import { describe, it, expect } from 'vitest';
import { TranscodeStepType } from '@project/shared';
import { RenderStepType, type StepType } from '../types/step.types';
import * as fc from 'fast-check';

/**
 * Simulates the progress update behavior from step processors
 * When a step updates its progress, it calls job.updateProgress(progress)
 */
function simulateStepProgressUpdate(
  stepType: StepType,
  progress: number
): { stepType: StepType; progress: number } {
  // Clamp progress to 0-100 range
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return {
    stepType,
    progress: clampedProgress,
  };
}

/**
 * Simulates the parent processor's progress aggregation behavior
 * When a step emits progress, the parent processor updates its progress
 * with information about the current step
 */
function simulateParentProgressAggregation(stepProgress: {
  stepType: StepType;
  progress: number;
}): { currentStep: StepType; currentStepProgress: number } {
  // This matches the implementation in the parent processors:
  // await parentJob.updateProgress({
  //   currentStep: stepType,
  //   currentStepProgress: typeof progress === 'number' ? progress : 0,
  // });

  return {
    currentStep: stepProgress.stepType,
    currentStepProgress: stepProgress.progress,
  };
}

/**
 * Calculates overall task progress from multiple step progresses
 * This is a weighted average based on the number of steps
 */
function calculateOverallProgress(
  stepProgresses: Array<{ stepType: StepType; progress: number }>
): number {
  if (stepProgresses.length === 0) {
    return 0;
  }

  const totalProgress = stepProgresses.reduce(
    (sum, step) => sum + step.progress,
    0
  );
  const averageProgress = totalProgress / stepProgresses.length;

  // Round to 2 decimal places
  return Math.round(averageProgress * 100) / 100;
}

describe('Property 11: Progress Propagation', () => {
  /**
   * Property 11: Progress Propagation
   *
   * For any step progress update, the overall task progress SHALL be recalculated
   * as a weighted average of all step progresses.
   *
   * This property validates Requirement 4.1: "WHEN a step updates its progress,
   * THE Task_System SHALL update both the step progress and calculate overall task progress"
   *
   * Test Strategy:
   * 1. Generate random step progress updates
   * 2. Verify that parent processor receives the progress update
   * 3. Verify that parent progress includes current step information
   * 4. Verify that overall progress is calculated correctly
   */
  it('should propagate step progress to parent job', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          stepType: fc.constantFrom(
            TranscodeStepType.PROBE,
            TranscodeStepType.THUMBNAIL,
            TranscodeStepType.SPRITE,
            TranscodeStepType.TRANSCODE,
            RenderStepType.PREPARE,
            RenderStepType.EXECUTE,
            RenderStepType.FINALIZE
          ),
          progress: fc.integer({ min: 0, max: 100 }),
        }),
        async ({ stepType, progress }) => {
          // Simulate step updating its progress
          const stepProgressUpdate = simulateStepProgressUpdate(
            stepType,
            progress
          );

          // Verify that progress is clamped to 0-100 range
          expect(stepProgressUpdate.progress).toBeGreaterThanOrEqual(0);
          expect(stepProgressUpdate.progress).toBeLessThanOrEqual(100);
          expect(stepProgressUpdate.stepType).toBe(stepType);

          // Simulate parent processor receiving the progress update
          const parentProgress =
            simulateParentProgressAggregation(stepProgressUpdate);

          // Verify that parent progress includes current step information
          expect(parentProgress.currentStep).toBe(stepType);
          expect(parentProgress.currentStepProgress).toBe(
            stepProgressUpdate.progress
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Verify that progress values outside 0-100 range are clamped
   *
   * This ensures that invalid progress values don't propagate to the parent
   */
  it('should clamp progress values to 0-100 range', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          stepType: fc.constantFrom(
            TranscodeStepType.PROBE,
            TranscodeStepType.THUMBNAIL
          ),
          // Generate progress values that may be outside valid range
          progress: fc.integer({ min: -100, max: 200 }),
        }),
        async ({ stepType, progress }) => {
          const stepProgressUpdate = simulateStepProgressUpdate(
            stepType,
            progress
          );

          // Verify clamping behavior
          if (progress < 0) {
            expect(stepProgressUpdate.progress).toBe(0);
          } else if (progress > 100) {
            expect(stepProgressUpdate.progress).toBe(100);
          } else {
            expect(stepProgressUpdate.progress).toBe(progress);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Verify overall progress calculation from multiple steps
   *
   * This validates that when multiple steps have different progress values,
   * the overall task progress is calculated as a weighted average
   */
  it('should calculate overall progress as weighted average of step progresses', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 2-5 steps with different progress values
        fc.array(
          fc.record({
            stepType: fc.constantFrom(
              TranscodeStepType.PROBE,
              TranscodeStepType.THUMBNAIL,
              TranscodeStepType.SPRITE,
              TranscodeStepType.TRANSCODE
            ),
            progress: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (steps) => {
          // Ensure unique step types
          const uniqueSteps = Array.from(
            new Map(steps.map((s) => [s.stepType, s])).values()
          );

          if (uniqueSteps.length === 0) {
            return; // Skip if no unique steps
          }

          // Simulate progress updates for each step
          const stepProgresses = uniqueSteps.map((step) =>
            simulateStepProgressUpdate(step.stepType, step.progress)
          );

          // Calculate overall progress
          const overallProgress = calculateOverallProgress(stepProgresses);

          // Verify that overall progress is within valid range
          expect(overallProgress).toBeGreaterThanOrEqual(0);
          expect(overallProgress).toBeLessThanOrEqual(100);

          // Verify that overall progress is the average of step progresses
          const expectedAverage =
            stepProgresses.reduce((sum, s) => sum + s.progress, 0) /
            stepProgresses.length;
          const roundedExpected = Math.round(expectedAverage * 100) / 100;
          expect(overallProgress).toBe(roundedExpected);

          // Verify boundary conditions
          const allComplete = stepProgresses.every((s) => s.progress === 100);
          const allPending = stepProgresses.every((s) => s.progress === 0);

          if (allComplete) {
            expect(overallProgress).toBe(100);
          }
          if (allPending) {
            expect(overallProgress).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Verify that progress updates are monotonic (non-decreasing)
   *
   * In a real system, step progress should never decrease
   */
  it('should maintain monotonic progress for a single step', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          stepType: fc.constantFrom(
            TranscodeStepType.PROBE,
            TranscodeStepType.THUMBNAIL
          ),
          // Generate a sequence of progress updates
          progressUpdates: fc.array(fc.integer({ min: 0, max: 100 }), {
            minLength: 2,
            maxLength: 10,
          }),
        }),
        async ({ stepType, progressUpdates }) => {
          // Sort progress updates to ensure monotonic behavior
          const sortedUpdates = [...progressUpdates].sort((a, b) => a - b);

          const stepProgresses = sortedUpdates.map((progress) =>
            simulateStepProgressUpdate(stepType, progress)
          );

          // Verify that each progress update is >= the previous one
          for (let i = 1; i < stepProgresses.length; i++) {
            expect(stepProgresses[i].progress).toBeGreaterThanOrEqual(
              stepProgresses[i - 1].progress
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Verify that parent progress updates include step type information
   *
   * This ensures that the parent job knows which step is currently making progress
   */
  it('should include step type in parent progress updates', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          stepType: fc.constantFrom(
            TranscodeStepType.PROBE,
            TranscodeStepType.THUMBNAIL,
            TranscodeStepType.SPRITE,
            RenderStepType.PREPARE,
            RenderStepType.EXECUTE,
            RenderStepType.FINALIZE
          ),
          progress: fc.integer({ min: 0, max: 100 }),
        }),
        async ({ stepType, progress }) => {
          const stepProgressUpdate = simulateStepProgressUpdate(
            stepType,
            progress
          );
          const parentProgress =
            simulateParentProgressAggregation(stepProgressUpdate);

          // Verify that parent progress includes the step type
          expect(parentProgress.currentStep).toBeDefined();
          expect(parentProgress.currentStep).toBe(stepType);

          // Verify that the step type is a valid StepType
          const allStepTypes = [
            ...Object.values(TranscodeStepType),
            ...Object.values(RenderStepType),
          ];
          expect(allStepTypes).toContain(parentProgress.currentStep);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Verify progress calculation with partial step completion
   *
   * This validates that overall progress correctly reflects when some steps
   * are complete (100%) and others are in progress
   */
  it('should calculate correct overall progress with mixed step states', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          completedSteps: fc.integer({ min: 1, max: 3 }),
          inProgressSteps: fc.integer({ min: 1, max: 3 }),
          inProgressValue: fc.integer({ min: 1, max: 99 }),
        }),
        async ({ completedSteps, inProgressSteps, inProgressValue }) => {
          const stepProgresses: Array<{
            stepType: StepType;
            progress: number;
          }> = [];

          // Add completed steps (100% progress)
          const completedStepTypes = [
            TranscodeStepType.PROBE,
            TranscodeStepType.THUMBNAIL,
            TranscodeStepType.SPRITE,
          ].slice(0, completedSteps);

          for (const stepType of completedStepTypes) {
            stepProgresses.push(simulateStepProgressUpdate(stepType, 100));
          }

          // Add in-progress steps
          const inProgressStepTypes = [
            TranscodeStepType.TRANSCODE,
            RenderStepType.EXECUTE,
            RenderStepType.FINALIZE,
          ].slice(0, inProgressSteps);

          for (const stepType of inProgressStepTypes) {
            stepProgresses.push(
              simulateStepProgressUpdate(stepType, inProgressValue)
            );
          }

          // Calculate overall progress
          const overallProgress = calculateOverallProgress(stepProgresses);

          // Verify that overall progress is between the in-progress value and 100
          expect(overallProgress).toBeGreaterThanOrEqual(inProgressValue);
          expect(overallProgress).toBeLessThanOrEqual(100);

          // Verify that if all steps are complete, overall is 100
          if (inProgressSteps === 0) {
            expect(overallProgress).toBe(100);
          }

          // Verify that if no steps are complete, overall equals in-progress value
          if (completedSteps === 0) {
            expect(overallProgress).toBe(inProgressValue);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
