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

/**
 * Formats seconds as M:SS — the coarse readout used by playheads, transport
 * rows and anywhere a timecode has to fit a phone's width.
 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
