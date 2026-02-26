import type { TypedPocketBase } from '@project/shared';
import {
  UploadMutator,
  TaskMutator,
  FileMutator,
} from '@project/shared/mutator';
import {
  UploadStatus,
  ProcessingProvider,
  type LabelsFlowConfig,
  type TranscodeFlowConfig,
} from '@project/shared';
import type { Upload, Task, UploadInput } from '@project/shared';
import type { UploadProgress } from '@/types/upload-manager';

/**
 * File validation result
 */
export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Upload service configuration
 */
export interface UploadServiceConfig {
  /** Allowed MIME types for uploads */
  allowedTypes?: string[];
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Default processing provider */
  defaultProvider?: ProcessingProvider;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Omit<Required<UploadServiceConfig>, 'storageConfig'> = {
  allowedTypes: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
  ],
  maxSize: 24 * 1024 * 1024 * 1024, // 24GB
  defaultProvider: ProcessingProvider.FFMPEG,
};

/**
 * Upload service that handles file uploads and processing orchestration
 * Validates files, manages upload lifecycle, and enqueues processing tasks
 */
export class UploadService {
  private pb: TypedPocketBase;
  private uploadMutator: UploadMutator;
  private taskMutator: TaskMutator;
  private fileMutator: FileMutator;
  private config: Required<UploadServiceConfig>;

  constructor(pb: TypedPocketBase, config?: UploadServiceConfig) {
    this.pb = pb;
    this.uploadMutator = new UploadMutator(pb);
    this.taskMutator = new TaskMutator(pb);
    this.fileMutator = new FileMutator(pb);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Upload a file via the Next.js API (server-side storage backend).
   *
   * This keeps all `@project/shared/storage` code (and thus `fs` / AWS SDK)
   * on the server, avoiding Next.js client-bundle failures.
   */
  private async uploadViaServer(
    uploadId: string,
    workspaceId: string,
    userId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Upload> {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const startTime = Date.now();

      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable || !onProgress) return;
        const elapsed = (Date.now() - startTime) / 1000; // seconds
        const speed = elapsed > 0 ? event.loaded / elapsed : 0;
        const remaining = speed > 0 ? (event.total - event.loaded) / speed : 0;

        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: (event.loaded / event.total) * 100,
          speed,
          estimatedTimeRemaining: remaining,
        });
      });

      xhr.addEventListener('load', () => {
        try {
          if (xhr.status < 200 || xhr.status >= 300) {
            // Try to parse error message from response
            let errorMessage = `Upload failed with status ${xhr.status}`;
            try {
              const errorResponse = JSON.parse(xhr.responseText) as {
                error?: string;
              };
              if (errorResponse.error) {
                errorMessage = errorResponse.error;
              }
            } catch {
              // Use default error message
            }
            reject(new Error(errorMessage));
            return;
          }
          const parsed = JSON.parse(xhr.responseText) as { upload: Upload };
          if (!parsed.upload) {
            reject(new Error('Invalid server response: missing upload data'));
            return;
          }
          resolve(parsed.upload);
        } catch (err) {
          reject(
            new Error(
              err instanceof Error
                ? err.message
                : 'Upload failed: invalid server response'
            )
          );
        }
      });

      xhr.addEventListener('error', () => {
        reject(
          new Error(
            'Upload failed due to network error. Please check your connection and try again.'
          )
        );
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload was cancelled'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timed out. Please try again.'));
      });

      const token = this.pb.authStore.token;
      if (!token) {
        reject(new Error('User must be authenticated to upload files'));
        return;
      }

      // Use streaming-friendly upload: send raw file body to PUT endpoint.
      // This avoids `req.formData()` buffering multi-GB payloads in memory on the server.
      xhr.open('PUT', '/api-next/uploads/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('x-upload-id', uploadId);
      xhr.setRequestHeader('x-workspace-id', workspaceId);
      xhr.setRequestHeader('x-user-id', userId);
      xhr.setRequestHeader('x-file-name', file.name);
      if (file.type) {
        xhr.setRequestHeader('Content-Type', file.type);
      }

      // Set timeout (30 minutes for large files)
      xhr.timeout = 30 * 60 * 1000;

      xhr.send(file);
    });
  }

  /**
   * Validate a file for upload
   * Checks file type and size against configured limits
   * @param file The file to validate
   * @returns Validation result with error message if invalid
   */
  validateFile(file: File): FileValidationResult {
    // Check file type
    if (!this.config.allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: `Invalid file type: ${file.type}. Allowed types: ${this.config.allowedTypes.join(', ')}`,
      };
    }

    // Check file size
    if (file.size > this.config.maxSize) {
      const maxSizeGB = this.config.maxSize / (1024 * 1024 * 1024);
      const fileSizeGB = (file.size / (1024 * 1024 * 1024)).toFixed(2);
      return {
        valid: false,
        error: `File too large: ${fileSizeGB}GB. Maximum allowed size: ${maxSizeGB}GB`,
      };
    }

    return { valid: true };
  }

  /**
   * Create an upload record with status "queued"
   * This is called before file transfer begins
   * @param workspaceId The workspace ID
   * @param file The file to upload
   * @param userId The user ID
   * @returns The created upload record
   */
  async createUploadRecord(
    workspaceId: string,
    file: File,
    userId: string
  ): Promise<Upload> {
    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Create upload record with status "queued"
    const uploadInput: UploadInput = {
      name: file.name,
      size: file.size,
      status: UploadStatus.QUEUED,
      bytesUploaded: 0,
      WorkspaceRef: workspaceId,
      UserRef: userId,
    };

    return this.uploadMutator.create(uploadInput);
  }

  /**
   * Start an upload - updates status to "uploading" and begins file transfer
   * @param uploadId The upload record ID
   * @param file The file to upload
   * @param onProgress Optional progress callback
   * @returns The updated upload record
   */
  async startUpload(
    uploadId: string,
    file: File,
    workspaceId: string,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Upload> {
    // Get the upload record
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    // Update status to uploading
    await this.uploadMutator.updateStatus(uploadId, UploadStatus.UPLOADING);

    // Perform file upload via server-side storage endpoint (S3/local)
    return await this.uploadViaServer(
      uploadId,
      workspaceId,
      userId,
      file,
      onProgress
    );
  }

  /**
   * Initiate an upload with file validation and task enqueueing
   * This is a convenience method that combines createUploadRecord, startUpload, and completeUpload
   * @param workspaceId The workspace ID
   * @param file The file to upload
   * @param userId The user ID
   * @param onProgress Optional progress callback
   * @returns The created upload record
   * @throws Error if validation fails or upload creation fails
   */
  async initiateUpload(
    workspaceId: string,
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress | number) => void
  ): Promise<Upload> {
    try {
      // Create upload record
      const upload = await this.createUploadRecord(workspaceId, file, userId);

      // Wrap progress callback to handle both old and new formats
      const wrappedProgress = onProgress
        ? (progress: UploadProgress) => {
            // Call with UploadProgress object
            onProgress(progress);
          }
        : undefined;

      // Start and complete upload
      return await this.startUpload(
        upload.id,
        file,
        workspaceId,
        userId,
        wrappedProgress
      );
    } catch (error) {
      // If upload creation failed, throw with context
      if (error instanceof Error) {
        throw new Error(`Upload failed: ${error.message}`);
      }
      throw new Error('Upload failed: Unknown error');
    }
  }

  async processUpload(
    workspaceId: string,
    uploadId: string,
    userId: string
  ): Promise<Task> {
    return this.processUploadAndDetectLabels(workspaceId, uploadId, userId);
  }

  async processUploadAndDetectLabels(
    workspaceId: string,
    uploadId: string,
    userId: string,
    transcodeConfig?: TranscodeFlowConfig,
    labelsConfig?: LabelsFlowConfig
  ): Promise<Task> {
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    if (upload.WorkspaceRef !== workspaceId) {
      throw new Error(`Upload ${uploadId} does not belong to workspace`);
    }

    return this.uploadMutator.processUploadAndDetectLabels(
      uploadId,
      userId,
      transcodeConfig,
      labelsConfig
    );
  }

  /**
   * Retry a failed upload by creating a new processing task
   * @param uploadId The upload ID to retry
   * @returns The new task
   * @throws Error if upload not found or not in failed state
   */
  async retryUpload(uploadId: string): Promise<Task> {
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    if (upload.status !== UploadStatus.FAILED) {
      throw new Error(
        `Upload is not in failed state. Current status: ${upload.status}`
      );
    }

    // Reset upload status to uploaded
    await this.uploadMutator.updateStatus(uploadId, UploadStatus.UPLOADED);

    // Create new processing task (using shared logic to ensure media exists and parallel tasks)
    return this.processUploadAndDetectLabels(
      upload.WorkspaceRef,
      uploadId,
      upload.UserRef as string
    );
  }

  /**
   * Cancel an in-progress upload
   * Updates the upload status to failed
   * @param uploadId The upload ID to cancel
   * @returns The updated upload
   * @throws Error if upload not found or not in cancellable state
   */
  async cancelUpload(uploadId: string): Promise<Upload> {
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    // Only allow cancellation of uploads in progress
    const cancellableStates: readonly UploadStatus[] = [
      UploadStatus.QUEUED,
      UploadStatus.UPLOADING,
      UploadStatus.UPLOADED,
      UploadStatus.PROCESSING,
    ] as const;

    if (
      !(cancellableStates as readonly UploadStatus[]).includes(
        upload.status as UploadStatus
      )
    ) {
      throw new Error(
        `Upload cannot be cancelled. Current status: ${upload.status}`
      );
    }

    // Update status to failed with cancellation message
    return this.uploadMutator.updateStatus(
      uploadId,
      UploadStatus.FAILED,
      'Upload cancelled by user'
    );
  }

  /**
   * Get uploads for a workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of uploads
   */
  async getWorkspaceUploads(workspaceId: string, page = 1, perPage = 50) {
    return this.uploadMutator.getByWorkspace(workspaceId, page, perPage);
  }

  /**
   * Get upload by ID
   * @param uploadId The upload ID
   * @returns The upload or null if not found
   */
  async getUpload(uploadId: string): Promise<Upload | null> {
    return this.uploadMutator.getById(uploadId);
  }
}

/**
 * Create an UploadService instance from a PocketBase client
 */
export function createUploadService(
  pb: TypedPocketBase,
  config: UploadServiceConfig
): UploadService {
  return new UploadService(pb, config);
}
