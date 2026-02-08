import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateClipPosition } from '../clip-position';
import type { TimelineClip } from '@project/shared';

/**
 * Property-Based Tests for Clip Positioning
 *
 * Feature: timeline-editor-enhancement
 *
 * These tests validate the correctness properties for clip positioning:
 * - Property 4: Absolute clip positioning correctness
 * - Property 5: Sequential clip positioning correctness
 */

describe('clip-position', () => {
  describe('Property 4: Absolute clip positioning correctness', () => {
    /**
     * **Validates: Requirements 2.1**
     *
     * For any TimelineClip with a defined `timelineStart` value and a given `pixelsPerSecond`,
     * the computed left position SHALL equal `timelineStart * pixelsPerSecond` and the width
     * SHALL equal `(end - start) * pixelsPerSecond`.
     */
    it('should position clips absolutely when timelineStart is defined', () => {
      fc.assert(
        fc.property(
          // Generate random clip with timelineStart defined
          fc.record({
            id: fc.string(),
            start: fc.double({ min: 0, max: 1000, noNaN: true }),
            end: fc.double({ min: 0, max: 1000, noNaN: true }),
            timelineStart: fc.double({ min: 0, max: 10000, noNaN: true }),
          }),
          // Generate random pixelsPerSecond
          fc.double({ min: 1, max: 100, noNaN: true }),
          (clipData, pixelsPerSecond) => {
            // Ensure end >= start
            const start = Math.min(clipData.start, clipData.end);
            const end = Math.max(clipData.start, clipData.end);

            const clip = {
              ...clipData,
              start,
              end,
            } as TimelineClip;

            const result = calculateClipPosition(clip, [], pixelsPerSecond);

            // Verify absolute positioning formula
            const expectedLeft = clip.timelineStart! * pixelsPerSecond;
            const expectedWidth = (end - start) * pixelsPerSecond;

            expect(result.left).toBeCloseTo(expectedLeft, 5);
            expect(result.width).toBeCloseTo(expectedWidth, 5);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle timelineStart of 0', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string(),
            start: fc.double({ min: 0, max: 1000, noNaN: true }),
            end: fc.double({ min: 0, max: 1000, noNaN: true }),
            timelineStart: fc.constant(0),
          }),
          fc.double({ min: 1, max: 100, noNaN: true }),
          (clipData, pixelsPerSecond) => {
            const start = Math.min(clipData.start, clipData.end);
            const end = Math.max(clipData.start, clipData.end);

            const clip = {
              ...clipData,
              start,
              end,
            } as TimelineClip;

            const result = calculateClipPosition(clip, [], pixelsPerSecond);

            expect(result.left).toBe(0);
            expect(result.width).toBeCloseTo(
              (end - start) * pixelsPerSecond,
              5
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 5: Sequential clip positioning correctness', () => {
    /**
     * **Validates: Requirements 2.2**
     *
     * For any ordered list of TimelineClips on the same track where none have `timelineStart` defined,
     * the left position of clip at index `i` SHALL equal the sum of durations `(end - start)` of all
     * clips at indices `0..i-1` multiplied by `pixelsPerSecond`.
     */
    it('should position clips sequentially when timelineStart is not defined', () => {
      fc.assert(
        fc.property(
          // Generate array of clips without timelineStart
          fc.array(
            fc.record({
              id: fc.string(),
              start: fc.double({ min: 0, max: 100, noNaN: true }),
              end: fc.double({ min: 0, max: 100, noNaN: true }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          fc.double({ min: 1, max: 100, noNaN: true }),
          (clipsData, pixelsPerSecond) => {
            // Ensure end >= start for all clips
            const clips = clipsData.map((clipData) => {
              const start = Math.min(clipData.start, clipData.end);
              const end = Math.max(clipData.start, clipData.end);
              return {
                ...clipData,
                start,
                end,
                timelineStart: undefined,
              } as TimelineClip;
            });

            // Test each clip in the sequence
            clips.forEach((clip, index) => {
              const precedingClips = clips.slice(0, index);
              const result = calculateClipPosition(
                clip,
                precedingClips,
                pixelsPerSecond
              );

              // Calculate expected accumulated time
              const expectedAccumulatedTime = precedingClips.reduce(
                (sum, c) => sum + (c.end - c.start),
                0
              );
              const expectedLeft = expectedAccumulatedTime * pixelsPerSecond;
              const expectedWidth = (clip.end - clip.start) * pixelsPerSecond;

              expect(result.left).toBeCloseTo(expectedLeft, 5);
              expect(result.width).toBeCloseTo(expectedWidth, 5);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should position first clip at 0 when no preceding clips', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string(),
            start: fc.double({ min: 0, max: 1000, noNaN: true }),
            end: fc.double({ min: 0, max: 1000, noNaN: true }),
          }),
          fc.double({ min: 1, max: 100, noNaN: true }),
          (clipData, pixelsPerSecond) => {
            const start = Math.min(clipData.start, clipData.end);
            const end = Math.max(clipData.start, clipData.end);

            const clip = {
              ...clipData,
              start,
              end,
              timelineStart: undefined,
            } as TimelineClip;

            const result = calculateClipPosition(clip, [], pixelsPerSecond);

            expect(result.left).toBe(0);
            expect(result.width).toBeCloseTo(
              (end - start) * pixelsPerSecond,
              5
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle clips with zero duration', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.string(),
              time: fc.double({ min: 0, max: 100, noNaN: true }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.double({ min: 1, max: 100, noNaN: true }),
          (clipsData, pixelsPerSecond) => {
            // Create clips with zero duration (start === end)
            const clips = clipsData.map((clipData) => ({
              ...clipData,
              start: clipData.time,
              end: clipData.time,
              timelineStart: undefined,
            })) as unknown as TimelineClip[];

            clips.forEach((clip, index) => {
              const precedingClips = clips.slice(0, index);
              const result = calculateClipPosition(
                clip,
                precedingClips,
                pixelsPerSecond
              );

              // All clips should be at position 0 since all have zero duration
              expect(result.left).toBe(0);
              expect(result.width).toBe(0);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge cases and mixed positioning', () => {
    it('should prefer absolute positioning over sequential when both are possible', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string(),
            start: fc.double({ min: 0, max: 100, noNaN: true }),
            end: fc.double({ min: 0, max: 100, noNaN: true }),
            timelineStart: fc.double({ min: 0, max: 1000, noNaN: true }),
          }),
          fc.array(
            fc.record({
              id: fc.string(),
              start: fc.double({ min: 0, max: 100, noNaN: true }),
              end: fc.double({ min: 0, max: 100, noNaN: true }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.double({ min: 1, max: 100, noNaN: true }),
          (clipData, precedingClipsData, pixelsPerSecond) => {
            const start = Math.min(clipData.start, clipData.end);
            const end = Math.max(clipData.start, clipData.end);

            const clip = {
              ...clipData,
              start,
              end,
            } as TimelineClip;

            const precedingClips = precedingClipsData.map((c) => ({
              ...c,
              start: Math.min(c.start, c.end),
              end: Math.max(c.start, c.end),
            })) as TimelineClip[];

            const result = calculateClipPosition(
              clip,
              precedingClips,
              pixelsPerSecond
            );

            // Should use absolute positioning (timelineStart), ignoring preceding clips
            const expectedLeft = clip.timelineStart! * pixelsPerSecond;
            expect(result.left).toBeCloseTo(expectedLeft, 5);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
