/**
 * Formats seconds into MM:SS.ms display format.
 * Used across clip editors, browser items, and trim handles.
 */
export function formatClipTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}
