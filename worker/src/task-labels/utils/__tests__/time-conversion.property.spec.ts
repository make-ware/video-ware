// Property-based tests for time conversion utilities
// Feature: label-clips, Property 5: Time Normalization to Seconds

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  toSeconds,
  millisecondsToSeconds,
  nanosecondsToSeconds,
  durationToSeconds,
  calculateDuration,
  normalizeTimeRange,
} from '../time-conversion';

describe('Time Conversion Properties', () => {
  describe('Property 5: Time Normalization to Seconds', () => {
    it('should convert milliseconds to seconds correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1001, max: 1_000_000_000 }), // milliseconds range
          (ms) => {
            const seconds = toSeconds(ms);
            const expected = ms / 1000;
            expect(seconds).toBeCloseTo(expected, 6);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should convert nanoseconds to seconds correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1_000_000_001, max: 10_000_000_000 }), // nanoseconds range
          (ns) => {
            const seconds = toSeconds(ns);
            const expected = ns / 1_000_000_000;
            expect(seconds).toBeCloseTo(expected, 9);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should convert Duration objects to seconds correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            seconds: fc.integer({ min: 0, max: 3600 }),
            nanos: fc.integer({ min: 0, max: 999_999_999 }),
          }),
          (duration) => {
            const seconds = toSeconds(duration);
            const expected = duration.seconds + duration.nanos / 1_000_000_000;
            expect(seconds).toBeCloseTo(expected, 9);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle Duration objects with string seconds', () => {
      fc.assert(
        fc.property(
          fc.record({
            seconds: fc.integer({ min: 0, max: 3600 }).map(String),
            nanos: fc.integer({ min: 0, max: 999_999_999 }),
          }),
          (duration) => {
            const seconds = toSeconds(duration);
            const expected =
              parseFloat(duration.seconds) + duration.nanos / 1_000_000_000;
            expect(seconds).toBeCloseTo(expected, 9);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should convert string formats with "s" suffix to seconds', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 3600, noNaN: true }), (value) => {
          const timeString = `${value}s`;
          const seconds = toSeconds(timeString);
          expect(seconds).toBeCloseTo(value, 6);
        }),
        { numRuns: 100 }
      );
    });

    it('should treat small numbers as seconds', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), (value) => {
          const seconds = toSeconds(value);
          expect(seconds).toBeCloseTo(value, 6);
        }),
        { numRuns: 100 }
      );
    });

    it('should calculate duration correctly from any time formats', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1000, noNaN: true }),
          fc.float({ min: 0, max: 1000, noNaN: true }),
          (val1, val2) => {
            // Ensure start < end
            const start = Math.min(val1, val2);
            const end = Math.max(val1, val2);
            if (start === end) return; // Skip equal values

            const duration = calculateDuration(start, end);
            expect(duration).toBeGreaterThanOrEqual(0);
            expect(duration).toBeCloseTo(end - start, 6);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should normalize time ranges with start < end invariant', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 100, noNaN: true }), // Keep values small to avoid millisecond interpretation
          fc.float({ min: Math.fround(0.1), max: 100, noNaN: true }),
          (start, offset) => {
            const end = start + offset;
            const normalized = normalizeTimeRange(start, end);

            expect(normalized.start).toBeLessThan(normalized.end);
            expect(normalized.duration).toBeCloseTo(
              normalized.end - normalized.start,
              6
            );
            expect(normalized.duration).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should throw error when start >= end', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000 }),
          fc.integer({ min: 0, max: 100 }),
          (start, end) => {
            expect(() => normalizeTimeRange(start, end)).toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle null and undefined as zero', () => {
      expect(toSeconds(null)).toBe(0);
      expect(toSeconds(undefined)).toBe(0);
      expect(calculateDuration(null, 100)).toBeCloseTo(100, 6);
      expect(calculateDuration(0, null)).toBe(0);
    });
  });

  describe('Specific conversion functions', () => {
    it('millisecondsToSeconds should always divide by 1000', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1_000_000 }), (ms) => {
          const seconds = millisecondsToSeconds(ms);
          expect(seconds).toBeCloseTo(ms / 1000, 6);
        }),
        { numRuns: 100 }
      );
    });

    it('nanosecondsToSeconds should always divide by 1_000_000_000', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), (ns) => {
          const seconds = nanosecondsToSeconds(ns);
          expect(seconds).toBeCloseTo(ns / 1_000_000_000, 9);
        }),
        { numRuns: 100 }
      );
    });

    it('durationToSeconds should combine seconds and nanos correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            seconds: fc.integer({ min: 0, max: 3600 }),
            nanos: fc.integer({ min: 0, max: 999_999_999 }),
          }),
          (duration) => {
            const seconds = durationToSeconds(duration);
            const expected = duration.seconds + duration.nanos / 1_000_000_000;
            expect(seconds).toBeCloseTo(expected, 9);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
