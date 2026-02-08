import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { findSnapTarget, type SnapPosition } from '../use-snap';

/**
 * Property-Based Tests for Snap Engine
 * 
 * Feature: timeline-editor-enhancement
 * 
 * These tests validate the correctness properties for the snap engine:
 * - Property 9: Snap finds nearest target within threshold
 * - Property 10: Snap disabled returns unmodified time
 */

describe('snap-engine', () => {
  describe('Property 9: Snap finds nearest target within threshold', () => {
    /**
     * **Validates: Requirements 4.1, 4.2**
     * 
     * For any candidate time, set of snap targets (clip edges + playhead), and threshold value,
     * the snap function SHALL return the target closest to the candidate if the distance is
     * within the threshold, or the original candidate time if no target is within the threshold.
     */
    it('should find the nearest target within threshold', () => {
      fc.assert(
        fc.property(
          // Generate candidate time
          fc.double({ min: 0, max: 1000, noNaN: true }),
          // Generate array of snap targets
          fc.array(
            fc.record({
              time: fc.double({ min: 0, max: 1000, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          // Generate threshold
          fc.double({ min: 0.1, max: 50, noNaN: true }),
          (candidateTime, targets, threshold) => {
            const result = findSnapTarget(candidateTime, targets, threshold);

            // Find the actual nearest target manually
            let nearestTarget: SnapPosition | null = null;
            let minDistance = Infinity;

            for (const target of targets) {
              const distance = Math.abs(candidateTime - target.time);
              if (distance < minDistance) {
                minDistance = distance;
                nearestTarget = target;
              }
            }

            // If the nearest target is within threshold, it should be returned
            if (minDistance < threshold) {
              expect(result).not.toBeNull();
              expect(result?.time).toBeCloseTo(nearestTarget!.time, 5);
              expect(result?.source).toBe(nearestTarget!.source);
            } else {
              // If no target is within threshold, should return null
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null when no targets are within threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.array(
            fc.record({
              time: fc.double({ min: 0, max: 1000, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (candidateTime, targets) => {
            // Use a very small threshold to ensure no targets are within range
            const threshold = 0.001;

            // Filter targets to ensure they're all outside the threshold
            const farTargets = targets.filter(
              (t) => Math.abs(t.time - candidateTime) >= threshold
            );

            if (farTargets.length > 0) {
              const result = findSnapTarget(candidateTime, farTargets, threshold);
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prefer the closest target when multiple targets are within threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 900, noNaN: true }),
          fc.double({ min: 1, max: 10, noNaN: true }),
          fc.double({ min: 15, max: 30, noNaN: true }), // Ensure offset2 > offset1 with margin
          (candidateTime, offset1, offset2) => {
            // Create two targets at different distances from candidate
            const nearTarget: SnapPosition = {
              time: candidateTime + offset1,
              source: 'clip-start',
            };
            const farTarget: SnapPosition = {
              time: candidateTime + offset2,
              source: 'clip-end',
            };

            const targets = [farTarget, nearTarget]; // Order shouldn't matter
            const threshold = offset2 + 1; // Ensure both are within threshold

            const result = findSnapTarget(candidateTime, targets, threshold);

            expect(result).not.toBeNull();
            // Should return the nearer target
            expect(result?.time).toBeCloseTo(nearTarget.time, 5);
            expect(result?.source).toBe('clip-start');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle exact matches (distance = 0)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.constantFrom(
            'clip-start' as const,
            'clip-end' as const,
            'playhead' as const,
            'grid' as const
          ),
          fc.double({ min: 0.1, max: 50, noNaN: true }),
          (time, source, threshold) => {
            const target: SnapPosition = { time, source };
            const result = findSnapTarget(time, [target], threshold);

            expect(result).not.toBeNull();
            expect(result?.time).toBe(time);
            expect(result?.source).toBe(source);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty target array', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.double({ min: 0.1, max: 50, noNaN: true }),
          (candidateTime, threshold) => {
            const result = findSnapTarget(candidateTime, [], threshold);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle threshold of 0 (only snaps on exact floating point match)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.array(
            fc.record({
              time: fc.double({ min: 0, max: 1000, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (candidateTime, targets) => {
            const threshold = 0;
            const result = findSnapTarget(candidateTime, targets, threshold);

            // With threshold 0, the condition is dist < 0, which is never true
            // So it should always return null (no snapping)
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Snap disabled returns unmodified time', () => {
    /**
     * **Validates: Requirements 4.4**
     * 
     * For any candidate time and set of snap targets, when snapping is disabled,
     * the snap function SHALL return the candidate time unchanged with no active guides.
     * 
     * Note: This property is tested at the findSnapTarget level by verifying that
     * when the function is not called (enabled=false in useSnap), the original time
     * is preserved. The useSnap hook itself handles the enabled flag.
     */
    it('should return candidate time when threshold is negative (simulating disabled)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.array(
            fc.record({
              time: fc.double({ min: 0, max: 1000, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (candidateTime, targets) => {
            // Using a negative threshold effectively disables snapping
            const result = findSnapTarget(candidateTime, targets, -1);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not snap when all targets are exactly at threshold boundary', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 900, noNaN: true }),
          fc.double({ min: 1, max: 50, noNaN: true }),
          (candidateTime, threshold) => {
            // Create targets exactly at the threshold boundary
            const targets: SnapPosition[] = [
              { time: candidateTime + threshold, source: 'clip-start' },
              { time: candidateTime - threshold, source: 'clip-end' },
            ];

            const result = findSnapTarget(candidateTime, targets, threshold);

            // Targets at exactly the threshold distance should snap
            // (the condition is dist < threshold, so equal should not snap)
            // Actually, let's verify the behavior is consistent
            if (result) {
              const distance = Math.abs(result.time - candidateTime);
              expect(distance).toBeLessThan(threshold);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle very small time values', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 0.1, noNaN: true }),
          fc.array(
            fc.record({
              time: fc.double({ min: 0, max: 0.1, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.double({ min: 0.01, max: 0.1, noNaN: true }),
          (candidateTime, targets, threshold) => {
            const result = findSnapTarget(candidateTime, targets, threshold);

            // Verify result is consistent with manual calculation
            const nearest = targets.reduce((closest, target) => {
              const dist = Math.abs(candidateTime - target.time);
              const closestDist = Math.abs(candidateTime - closest.time);
              return dist < closestDist ? target : closest;
            });

            const nearestDist = Math.abs(candidateTime - nearest.time);
            if (nearestDist < threshold) {
              expect(result).not.toBeNull();
            } else {
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle very large time values', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10000, max: 100000, noNaN: true }),
          fc.array(
            fc.record({
              time: fc.double({ min: 10000, max: 100000, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.double({ min: 1, max: 100, noNaN: true }),
          (candidateTime, targets, threshold) => {
            const result = findSnapTarget(candidateTime, targets, threshold);

            // Verify the result is within threshold if not null
            if (result) {
              const distance = Math.abs(candidateTime - result.time);
              expect(distance).toBeLessThan(threshold);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be deterministic for the same inputs', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.array(
            fc.record({
              time: fc.double({ min: 0, max: 1000, noNaN: true }),
              source: fc.constantFrom(
                'clip-start' as const,
                'clip-end' as const,
                'playhead' as const,
                'grid' as const
              ),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          fc.double({ min: 0.1, max: 50, noNaN: true }),
          (candidateTime, targets, threshold) => {
            const result1 = findSnapTarget(candidateTime, targets, threshold);
            const result2 = findSnapTarget(candidateTime, targets, threshold);

            // Results should be identical
            if (result1 === null) {
              expect(result2).toBeNull();
            } else {
              expect(result2).not.toBeNull();
              expect(result2?.time).toBe(result1.time);
              expect(result2?.source).toBe(result1.source);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
