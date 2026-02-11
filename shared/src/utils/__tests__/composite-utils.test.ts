/**
 * Tests for composite clip utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isCompositeClip,
  isMediaClipComposite,
  getCompositeSegments,
  calculateEffectiveDuration,
  buildCompositeTimeMapping,
  expandCompositeToSegments,
  calculateExpandedDuration,
} from '../composite-utils';

describe('composite-utils', () => {
  const exampleSegments = [
    { start: 1.8, end: 6.7 }, // 4.9s
    { start: 12.3, end: 13.5 }, // 1.2s
    { start: 14.8, end: 17.1 }, // 2.3s
    { start: 28.9, end: 31.1 }, // 2.2s
  ];
  // Total effective duration: 4.9 + 1.2 + 2.3 + 2.2 = 10.6s

  describe('isCompositeClip', () => {
    it('should return true for composite type with valid segments', () => {
      expect(isCompositeClip('composite', { segments: exampleSegments })).toBe(
        true
      );
    });

    it('should return false for non-composite type', () => {
      expect(isCompositeClip('video', { segments: exampleSegments })).toBe(
        false
      );
    });

    it('should return false for composite type without segments', () => {
      expect(isCompositeClip('composite', {})).toBe(false);
      expect(isCompositeClip('composite', { segments: [] })).toBe(false);
    });

    it('should return false for undefined clipData', () => {
      expect(isCompositeClip('composite', undefined)).toBe(false);
    });
  });

  describe('isMediaClipComposite', () => {
    it('should return true for composite MediaClip with segments', () => {
      const mediaClip = {
        id: 'test',
        type: 'composite',
        clipData: { segments: exampleSegments },
      } as any;
      expect(isMediaClipComposite(mediaClip)).toBe(true);
    });

    it('should return false for null/undefined', () => {
      expect(isMediaClipComposite(null)).toBe(false);
      expect(isMediaClipComposite(undefined)).toBe(false);
    });
  });

  describe('getCompositeSegments', () => {
    it('should return segments for composite MediaClip', () => {
      const mediaClip = {
        id: 'test',
        type: 'composite',
        clipData: { segments: exampleSegments },
      } as any;
      expect(getCompositeSegments(mediaClip)).toEqual(exampleSegments);
    });

    it('should return undefined for non-composite', () => {
      const mediaClip = {
        id: 'test',
        type: 'video',
        clipData: {},
      } as any;
      expect(getCompositeSegments(mediaClip)).toBeUndefined();
    });
  });

  describe('calculateEffectiveDuration', () => {
    it('should sum segment durations', () => {
      const result = calculateEffectiveDuration(1.8, 31.1, exampleSegments);
      expect(result).toBeCloseTo(10.6, 1);
    });

    it('should fallback to end - start if no segments', () => {
      expect(calculateEffectiveDuration(1.8, 31.1, undefined)).toBeCloseTo(
        29.3,
        1
      );
      expect(calculateEffectiveDuration(1.8, 31.1, [])).toBeCloseTo(29.3, 1);
    });

    it('should handle single segment', () => {
      const result = calculateEffectiveDuration(0, 10, [{ start: 0, end: 5 }]);
      expect(result).toBe(5);
    });
  });

  describe('buildCompositeTimeMapping', () => {
    it('should create a mapping from composite to source time', () => {
      const mapping = buildCompositeTimeMapping(exampleSegments);

      expect(mapping).toHaveLength(4);

      // First segment
      expect(mapping[0]).toEqual({
        compositeStart: 0,
        compositeEnd: 4.9,
        sourceStart: 1.8,
        sourceEnd: 6.7,
        duration: 4.9,
      });

      // Second segment starts at end of first
      expect(mapping[1].compositeStart).toBeCloseTo(4.9, 1);
      expect(mapping[1].compositeEnd).toBeCloseTo(6.1, 1);
      expect(mapping[1].sourceStart).toBe(12.3);
    });

    it('should sort segments by start time when given out of order', () => {
      const unsortedSegments = [
        { start: 28.9, end: 31.1 },
        { start: 1.8, end: 6.7 },
        { start: 14.8, end: 17.1 },
        { start: 12.3, end: 13.5 },
      ];
      const mapping = buildCompositeTimeMapping(unsortedSegments);

      // Should produce same result as sorted
      expect(mapping).toHaveLength(4);
      expect(mapping[0].sourceStart).toBe(1.8);
      expect(mapping[1].sourceStart).toBe(12.3);
      expect(mapping[2].sourceStart).toBe(14.8);
      expect(mapping[3].sourceStart).toBe(28.9);
    });

    it('should handle single segment', () => {
      const mapping = buildCompositeTimeMapping([{ start: 5, end: 10 }]);
      expect(mapping).toHaveLength(1);
      expect(mapping[0]).toEqual({
        compositeStart: 0,
        compositeEnd: 5,
        sourceStart: 5,
        sourceEnd: 10,
        duration: 5,
      });
    });
  });

  describe('expandCompositeToSegments', () => {
    it('should expand all segments when using full duration', () => {
      const expanded = expandCompositeToSegments(
        exampleSegments,
        0, // usageSourceStart
        10.6, // usageDuration (full)
        0 // timelineStart
      );

      expect(expanded).toHaveLength(4);

      // First segment at timeline 0
      expect(expanded[0].timelineStart).toBe(0);
      expect(expanded[0].sourceStart).toBeCloseTo(1.8, 1);
      expect(expanded[0].duration).toBeCloseTo(4.9, 1);

      // Second segment follows the first
      expect(expanded[1].timelineStart).toBeCloseTo(4.9, 1);
      expect(expanded[1].sourceStart).toBeCloseTo(12.3, 1);
    });

    it('should offset for non-zero timeline start', () => {
      const expanded = expandCompositeToSegments(
        exampleSegments,
        0,
        10.6,
        5.0 // Start at 5 seconds on timeline
      );

      expect(expanded[0].timelineStart).toBe(5.0);
      expect(expanded[1].timelineStart).toBeCloseTo(9.9, 1);
    });

    it('should handle partial usage from middle', () => {
      // Start at composite time 4.0 (still in first segment), use 3s
      const expanded = expandCompositeToSegments(
        exampleSegments,
        4.0, // usageSourceStart - 4s into composite time
        3.0, // usageDuration - 3 seconds
        0
      );

      // This should capture:
      // - Last 0.9s of first segment (composite 4.0-4.9)
      // - All of second segment 1.2s (composite 4.9-6.1)
      // - First 0.9s of third segment (composite 6.1-7.0)
      expect(expanded.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty when usage range is outside segments', () => {
      const expanded = expandCompositeToSegments(
        exampleSegments,
        100, // Past end of composite
        5,
        0
      );
      expect(expanded).toHaveLength(0);
    });

    it('should handle single segment expansion', () => {
      const expanded = expandCompositeToSegments(
        [{ start: 2.5, end: 5.5 }],
        0,
        3,
        10
      );
      expect(expanded).toHaveLength(1);
      expect(expanded[0].sourceStart).toBe(2.5);
      expect(expanded[0].duration).toBe(3);
      expect(expanded[0].timelineStart).toBe(10);
    });

    it('should correctly map sourceStart when usage starts mid-segment', () => {
      // Usage starts at composite 2.0 (2s into first segment), use 2s total
      // First segment: composite 0-4.9, source 1.8-6.7. At composite 2.0, we're at source 3.8
      const expanded = expandCompositeToSegments(
        exampleSegments,
        2.0,
        2.0, // 2 seconds - fits entirely in remainder of first segment
        0
      );
      expect(expanded[0].sourceStart).toBeCloseTo(3.8, 1); // 1.8 + 2.0
      expect(expanded[0].duration).toBe(2); // 2 seconds as requested
    });
  });

  describe('calculateExpandedDuration', () => {
    it('should calculate total duration from expanded segments', () => {
      const duration = calculateExpandedDuration(exampleSegments, 0, 10.6);
      expect(duration).toBeCloseTo(10.6, 1);
    });
  });
});
