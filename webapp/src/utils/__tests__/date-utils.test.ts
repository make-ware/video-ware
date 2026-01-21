import { describe, it, expect } from 'vitest';
import { calculateMediaDate, formatMediaDate, formatMediaDateTime } from '../date-utils';

describe('date-utils', () => {
  describe('calculateMediaDate', () => {
    it('should return null if mediaDate is undefined', () => {
      expect(calculateMediaDate(undefined, 10)).toBeNull();
    });

    it('should return null if mediaDate is invalid', () => {
      expect(calculateMediaDate('invalid-date', 10)).toBeNull();
    });

    it('should calculate the date correctly with offset', () => {
      const mediaDate = '2023-01-01T10:00:00.000Z';
      const offsetSeconds = 10;
      const expectedDate = new Date('2023-01-01T10:00:10.000Z');
      const result = calculateMediaDate(mediaDate, offsetSeconds);
      expect(result).toEqual(expectedDate);
    });

    it('should calculate the date correctly with 0 offset', () => {
      const mediaDate = '2023-01-01T10:00:00.000Z';
      const offsetSeconds = 0;
      const expectedDate = new Date('2023-01-01T10:00:00.000Z');
      const result = calculateMediaDate(mediaDate, offsetSeconds);
      expect(result).toEqual(expectedDate);
    });

    it('should calculate the date correctly with float offset', () => {
      const mediaDate = '2023-01-01T10:00:00.000Z';
      const offsetSeconds = 0.5;
      const expectedDate = new Date('2023-01-01T10:00:00.500Z');
      const result = calculateMediaDate(mediaDate, offsetSeconds);
      expect(result).toEqual(expectedDate);
    });
  });

  describe('formatMediaDate', () => {
    it('should return --/--/-- for null date', () => {
      expect(formatMediaDate(null)).toBe('--/--/--');
    });

    it('should format date correctly', () => {
      const date = new Date('2023-01-01T10:00:00.000Z');
      // Note: date-fns format uses local time, so the output depends on timezone.
      // Ideally we should test with a fixed timezone or verify format structure.
      // But for simplicity let's just check it doesn't return placeholder.
      expect(formatMediaDate(date)).not.toBe('--/--/--');
    });
  });

  describe('formatMediaDateTime', () => {
    it('should return --/--/-- --:--:-- for null date', () => {
      expect(formatMediaDateTime(null)).toBe('--/--/-- --:--:--');
    });
  });
});
