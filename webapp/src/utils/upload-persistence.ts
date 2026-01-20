'use client';
/**
 * Upload State Persistence
 *
 * Utilities for saving and restoring upload queue state to/from localStorage.
 * This allows uploads to survive page refreshes and browser restarts.
 */

import type { UploadItem, UploadQueueState } from '@/types/upload-manager';
import { UploadItemStatus } from '@/types/upload-manager';

// Storage key for localStorage
const STORAGE_KEY = 'upload-queue-state';

// Maximum age for persisted uploads (24 hours)
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Serializable version of UploadItem (excludes File object)
 */
interface SerializableUploadItem extends Omit<
  UploadItem,
  'file' | 'createdAt' | 'startedAt' | 'completedAt'
> {
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Serializable version of UploadQueueState
 */
interface SerializableQueueState extends Omit<UploadQueueState, 'items'> {
  items: SerializableUploadItem[];
  version: number; // Schema version for future migrations
  savedAt: string; // Timestamp when saved
}

/**
 * Convert UploadItem to serializable format
 */
function serializeItem(item: UploadItem): SerializableUploadItem {
  return {
    id: item.id,
    uploadId: item.uploadId,
    // File object is not serializable, we'll need to handle this on restore
    fileName: item.fileName,
    fileSize: item.fileSize,
    fileType: item.fileType,
    status: item.status,
    progress: item.progress,
    error: item.error,
    retryCount: item.retryCount,
    createdAt: item.createdAt.toISOString(),
    startedAt: item.startedAt?.toISOString(),
    completedAt: item.completedAt?.toISOString(),
    workspaceId: item.workspaceId,
    storageBackend: item.storageBackend,
    externalPath: item.externalPath,
    thumbnail: item.thumbnail,
  };
}

/**
 * Convert serializable item back to UploadItem
 * Note: File object cannot be restored, so these items should be marked as stale
 */
function deserializeItem(
  item: SerializableUploadItem
): Omit<UploadItem, 'file'> {
  return {
    id: item.id,
    uploadId: item.uploadId,
    fileName: item.fileName,
    fileSize: item.fileSize,
    fileType: item.fileType,
    status: item.status,
    progress: item.progress,
    error: item.error,
    retryCount: item.retryCount,
    createdAt: new Date(item.createdAt),
    startedAt: item.startedAt ? new Date(item.startedAt) : undefined,
    completedAt: item.completedAt ? new Date(item.completedAt) : undefined,
    workspaceId: item.workspaceId,
    storageBackend: item.storageBackend,
    externalPath: item.externalPath,
    thumbnail: item.thumbnail,
  };
}

/**
 * Save upload queue state to localStorage
 *
 * @param state - Current upload queue state
 */
export function saveQueueState(state: UploadQueueState): void {
  try {
    const serializable: SerializableQueueState = {
      items: state.items.map(serializeItem),
      activeCount: state.activeCount,
      maxConcurrent: state.maxConcurrent,
      totalProgress: state.totalProgress,
      isPaused: state.isPaused,
      version: 1,
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (error) {
    console.error('Failed to save upload queue state:', error);
    // Don't throw - persistence is a nice-to-have, not critical
  }
}

/**
 * Restore upload queue state from localStorage
 *
 * @returns Restored state or null if no valid state exists
 */
export function restoreQueueState(): Partial<UploadQueueState> | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return null;
    }

    const parsed: SerializableQueueState = JSON.parse(stored);

    // Check version compatibility
    if (parsed.version !== 1) {
      console.warn('Incompatible upload queue state version, clearing');
      clearQueueState();
      return null;
    }

    // Check age
    const savedAt = new Date(parsed.savedAt);
    const age = Date.now() - savedAt.getTime();

    if (age > MAX_AGE_MS) {
      console.warn('Upload queue state too old, clearing');
      clearQueueState();
      return null;
    }

    // Deserialize items
    const items = parsed.items.map(deserializeItem);

    // Filter out stale uploads (those that were in progress)
    // We can only restore completed uploads since we don't have the File objects
    const restoredItems = items.filter((item) => {
      // Keep completed uploads
      if (item.status === UploadItemStatus.COMPLETED) {
        return true;
      }

      // Keep failed uploads that have uploadId (can be retried)
      if (item.status === UploadItemStatus.FAILED && item.uploadId) {
        return true;
      }

      // Discard everything else (queued, uploading, paused, cancelled)
      // These need the File object which we can't restore
      return false;
    });

    // If no items to restore, return null
    if (restoredItems.length === 0) {
      clearQueueState();
      return null;
    }

    return {
      items: restoredItems as UploadItem[], // Cast needed due to missing File
      isPaused: false, // Always start unpaused after restore
    };
  } catch (error) {
    console.error('Failed to restore upload queue state:', error);
    clearQueueState();
    return null;
  }
}

/**
 * Clear persisted upload queue state
 */
export function clearQueueState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear upload queue state:', error);
  }
}

/**
 * Check if there is persisted state available
 *
 * @returns True if persisted state exists
 */
export function hasPersistedState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Handle stale/orphaned uploads
 *
 * This function identifies uploads that were in progress when the page was closed
 * and marks them appropriately. Since we can't restore the File objects, these
 * uploads need to be handled specially.
 *
 * @param items - Current upload items
 * @returns Items with stale uploads handled
 */
export function handleStaleUploads(items: UploadItem[]): UploadItem[] {
  return items.map((item) => {
    // If upload was in progress but we don't have the File object
    // (this shouldn't happen with our filtering, but just in case)
    if (
      (item.status === UploadItemStatus.UPLOADING ||
        item.status === UploadItemStatus.QUEUED ||
        item.status === UploadItemStatus.PAUSED) &&
      !item.file
    ) {
      return {
        ...item,
        status: UploadItemStatus.FAILED,
        error: 'Upload was interrupted. Please retry.',
      };
    }

    return item;
  });
}

/**
 * Get storage usage information
 *
 * @returns Object with used and available space info
 */
export function getStorageInfo(): {
  used: number;
  available: number;
  percentage: number;
} | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const used = stored ? new Blob([stored]).size : 0;

    // localStorage typically has 5-10MB limit
    // We'll assume 5MB as a conservative estimate
    const available = 5 * 1024 * 1024;
    const percentage = (used / available) * 100;

    return {
      used,
      available,
      percentage,
    };
  } catch {
    return null;
  }
}
