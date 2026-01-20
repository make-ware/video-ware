/**
 * Upload Manager Types
 *
 * Defines types for the client-side upload queue manager that handles
 * multiple concurrent uploads with progress tracking.
 */

import type { StorageBackendType } from '@project/shared';

/**
 * Status of an individual upload item in the queue
 */
export enum UploadItemStatus {
  QUEUED = 'queued',
  UPLOADING = 'uploading',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Progress information for an upload
 */
export interface UploadProgress {
  loaded: number; // Bytes uploaded so far
  total: number; // Total bytes to upload
  percentage: number; // Progress percentage (0-100)
  speed: number; // Upload speed in bytes per second
  estimatedTimeRemaining: number; // Estimated seconds remaining
}

/**
 * Individual upload item in the queue
 */
export interface UploadItem {
  id: string; // Client-side ID (UUID)
  uploadId?: string; // PocketBase Upload record ID (once created)
  file: File; // The file being uploaded
  fileName: string; // Original file name
  fileSize: number; // File size in bytes
  fileType: string; // MIME type
  status: UploadItemStatus; // Current status
  progress: UploadProgress; // Upload progress
  error?: string; // Error message if failed
  retryCount: number; // Number of retry attempts
  createdAt: Date; // When the upload was queued
  startedAt?: Date; // When upload started
  completedAt?: Date; // When upload completed
  workspaceId: string; // Target workspace
  storageBackend: StorageBackendType; // Storage backend to use
  externalPath?: string; // Path in external storage (once uploaded)
  thumbnail?: string; // Data URL for preview (optional)
}

/**
 * Overall state of the upload queue
 */
export interface UploadQueueState {
  items: UploadItem[]; // All upload items
  activeCount: number; // Number of currently uploading items
  maxConcurrent: number; // Maximum concurrent uploads
  totalProgress: {
    completed: number; // Number of completed uploads
    total: number; // Total number of uploads
    percentage: number; // Overall progress percentage
  };
  isPaused: boolean; // Whether the entire queue is paused
}

/**
 * Actions available for managing the upload queue
 */
export interface UploadManagerActions {
  // Add files to the queue
  addFiles(files: File[], workspaceId: string): void;

  // Individual upload controls
  pauseUpload(id: string): void;
  resumeUpload(id: string): void;
  cancelUpload(id: string): void;
  retryUpload(id: string): void;

  // Batch controls
  pauseAll(): void;
  resumeAll(): void;
  cancelAll(): void;
  clearCompleted(): void;

  // Configuration
  setMaxConcurrent(count: number): void;
}
