import { format } from 'date-fns';

/**
 * Calculates the date of a specific point in a media file, based on the media's original date.
 *
 * @param mediaDate The original date of the media (e.g., when it was shot).
 * @param offsetSeconds The offset in seconds from the start of the media.
 * @returns The calculated Date, or null if mediaDate is invalid or missing.
 */
export function calculateMediaDate(
  mediaDate: string | Date | undefined,
  offsetSeconds: number = 0
): Date | null {
  if (!mediaDate) return null;

  const date = new Date(mediaDate);
  if (isNaN(date.getTime())) return null;

  return new Date(date.getTime() + offsetSeconds * 1000);
}

/**
 * Formats a date for display.
 * Default format: yyyy/MM/dd
 *
 * @param date The date to format.
 * @param formatStr Optional format string (defaults to 'yyyy/MM/dd').
 * @returns The formatted date string, or '--/--/--' if the date is null/undefined.
 */
export function formatMediaDate(
  date: Date | null | undefined,
  formatStr: string = 'yyyy/MM/dd'
): string {
  if (!date || isNaN(date.getTime())) return '--/--/--';
  return format(date, formatStr);
}

/**
 * Formats a date for display with time.
 * Default format: yyyy/MM/dd HH:mm:ss
 */
export function formatMediaDateTime(
  date: Date | null | undefined,
  formatStr: string = 'yyyy/MM/dd HH:mm:ss'
): string {
  if (!date || isNaN(date.getTime())) return '--/--/-- --:--:--';
  return format(date, formatStr);
}
