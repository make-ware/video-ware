/**
 * Upload Progress Utilities
 *
 * Functions for calculating upload progress, speed, and estimated time remaining.
 */

import type { UploadProgress, UploadItem } from '@/types/upload-manager';

/**
 * Calculate progress information for an upload
 *
 * @param loaded - Bytes uploaded so far
 * @param total - Total bytes to upload
 * @param startTime - When the upload started (timestamp in ms)
 * @param currentTime - Current time (timestamp in ms)
 * @returns Progress information including percentage, speed, and ETA
 */
export function calculateProgress(
  loaded: number,
  total: number,
  startTime: number,
  currentTime: number = Date.now()
): UploadProgress {
  // Ensure values are non-negative
  const safeLoaded = Math.max(0, loaded);
  const safeTotal = Math.max(1, total); // Avoid division by zero

  // Calculate percentage (0-100)
  const percentage = Math.min(100, (safeLoaded / safeTotal) * 100);

  // Calculate elapsed time in seconds
  const elapsedMs = Math.max(1, currentTime - startTime); // Avoid division by zero
  const elapsedSeconds = elapsedMs / 1000;

  // Calculate speed in bytes per second
  const speed = safeLoaded / elapsedSeconds;

  // Calculate estimated time remaining in seconds
  const remainingBytes = safeTotal - safeLoaded;
  const estimatedTimeRemaining = speed > 0 ? remainingBytes / speed : 0;

  return {
    loaded: safeLoaded,
    total: safeTotal,
    percentage,
    speed,
    estimatedTimeRemaining,
  };
}

/**
 * Calculate upload speed in bytes per second
 *
 * @param loaded - Bytes uploaded so far
 * @param elapsedSeconds - Time elapsed since upload started
 * @returns Speed in bytes per second
 */
export function calculateSpeed(loaded: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) {
    return 0;
  }
  return loaded / elapsedSeconds;
}

/**
 * Calculate estimated time remaining in seconds
 *
 * @param loaded - Bytes uploaded so far
 * @param total - Total bytes to upload
 * @param speed - Current upload speed in bytes per second
 * @returns Estimated seconds remaining
 */
export function calculateETA(
  loaded: number,
  total: number,
  speed: number
): number {
  if (speed <= 0 || loaded >= total) {
    return 0;
  }
  const remainingBytes = total - loaded;
  return remainingBytes / speed;
}

/**
 * Calculate total progress across multiple uploads
 *
 * @param items - Array of upload items
 * @returns Total progress information
 */
export function calculateTotalProgress(items: UploadItem[]): {
  completed: number;
  total: number;
  percentage: number;
  totalLoaded: number;
  totalSize: number;
} {
  const total = items.length;

  if (total === 0) {
    return {
      completed: 0,
      total: 0,
      percentage: 0,
      totalLoaded: 0,
      totalSize: 0,
    };
  }

  // Count completed uploads
  const completed = items.filter((item) => item.status === 'completed').length;

  // Calculate total bytes loaded and total size
  let totalLoaded = 0;
  let totalSize = 0;

  for (const item of items) {
    totalSize += item.fileSize;

    if (item.status === 'completed') {
      totalLoaded += item.fileSize;
    } else if (item.status === 'uploading') {
      totalLoaded += item.progress.loaded;
    }
    // For queued, paused, failed, cancelled: don't add to loaded
  }

  // Calculate overall percentage
  const percentage = totalSize > 0 ? (totalLoaded / totalSize) * 100 : 0;

  return {
    completed,
    total,
    percentage,
    totalLoaded,
    totalSize,
  };
}

/**
 * Format bytes to human-readable string
 *
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format seconds to human-readable time string
 *
 * @param seconds - Number of seconds
 * @returns Formatted string (e.g., "2m 30s", "1h 5m")
 */
export function formatTime(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) {
    return '--';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format speed to human-readable string
 *
 * @param bytesPerSecond - Speed in bytes per second
 * @returns Formatted string (e.g., "1.5 MB/s")
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
