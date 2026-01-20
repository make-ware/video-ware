/**
 * Chunked Upload Service
 *
 * Handles large file uploads by splitting them into chunks to bypass
 * proxy limits (e.g., Cloudflare Tunnel's 100MB limit).
 *
 * Features:
 * - Splits files into configurable chunk sizes (default: 100MB)
 * - Sequential chunk upload with progress tracking
 * - Per-chunk retry logic
 * - Minimal database writes (only on completion)
 */

import type { TypedPocketBase } from '@project/shared';
import { UploadMutator } from '@project/shared/mutator';
import { UploadStatus } from '@project/shared';
import type { Upload } from '@project/shared';

/**
 * Progress callback for chunk uploads
 */
export interface ChunkProgress {
  chunkIndex: number; // Current chunk being uploaded (0-based)
  totalChunks: number; // Total number of chunks
  chunkProgress: number; // Progress within current chunk (0-100)
  overallProgress: number; // Overall upload progress (0-100)
  bytesUploaded: number; // Total bytes uploaded so far
  totalBytes: number; // Total file size
  currentChunkSize: number; // Size of current chunk
}

/**
 * Configuration for chunked uploads
 */
export interface ChunkedUploadConfig {
  chunkSize?: number; // Size of each chunk in bytes (default: 100MB)
  maxRetries?: number; // Max retries per chunk (default: 3)
  timeout?: number; // Timeout per chunk in ms (default: 5 minutes)
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ChunkedUploadConfig> = {
  chunkSize: 100 * 1024 * 1024, // 100MB (more stable for various network conditions)
  maxRetries: 3,
  timeout: 10 * 60 * 1000, // 10 minutes
};

/**
 * Chunked upload service
 */
export class ChunkedUploadService {
  private pb: TypedPocketBase;
  private uploadMutator: UploadMutator;
  private config: Required<ChunkedUploadConfig>;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(pb: TypedPocketBase, config?: ChunkedUploadConfig) {
    this.pb = pb;
    this.uploadMutator = new UploadMutator(pb);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Upload a single chunk
   */
  private async uploadChunk(
    uploadId: string,
    workspaceId: string,
    userId: string,
    fileName: string,
    chunk: Blob,
    chunkIndex: number,
    totalChunks: number,
    abortSignal: AbortSignal,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Handle abort
      const abortHandler = () => {
        xhr.abort();
        reject(new Error('Upload cancelled'));
      };
      abortSignal.addEventListener('abort', abortHandler);

      // Track progress within this chunk
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(event.loaded, event.total);
        }
      });

      xhr.addEventListener('load', () => {
        abortSignal.removeEventListener('abort', abortHandler);

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          let errorMessage = `Chunk ${chunkIndex + 1} failed with status ${xhr.status}`;
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
        }
      });

      xhr.addEventListener('error', () => {
        abortSignal.removeEventListener('abort', abortHandler);
        reject(new Error(`Network error uploading chunk ${chunkIndex + 1}`));
      });

      xhr.addEventListener('timeout', () => {
        abortSignal.removeEventListener('abort', abortHandler);
        reject(new Error(`Chunk ${chunkIndex + 1} upload timed out`));
      });

      const token = this.pb.authStore.token;
      if (!token) {
        reject(new Error('User must be authenticated to upload files'));
        return;
      }

      xhr.open('PUT', '/api-next/uploads/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('x-upload-id', uploadId);
      xhr.setRequestHeader('x-workspace-id', workspaceId);
      xhr.setRequestHeader('x-user-id', userId);
      xhr.setRequestHeader('x-file-name', fileName);
      xhr.setRequestHeader('x-chunk-index', chunkIndex.toString());
      xhr.setRequestHeader('x-total-chunks', totalChunks.toString());
      xhr.setRequestHeader('x-chunk-size', chunk.size.toString());
      xhr.timeout = this.config.timeout;

      xhr.send(chunk);
    });
  }

  /**
   * Upload a file in chunks
   */
  async uploadFile(
    uploadId: string,
    workspaceId: string,
    userId: string,
    file: File,
    onProgress?: (progress: ChunkProgress) => void
  ): Promise<Upload> {
    const totalChunks = Math.ceil(file.size / this.config.chunkSize);
    const abortController = new AbortController();
    this.abortControllers.set(uploadId, abortController);

    try {
      let totalBytesUploaded = 0;
      let lastProgressUpdate = 0;
      const PROGRESS_UPDATE_INTERVAL = 1000; // ms

      // Upload each chunk sequentially
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * this.config.chunkSize;
        const end = Math.min(start + this.config.chunkSize, file.size);
        const chunk = file.slice(start, end);
        const chunkSize = chunk.size;

        let retries = 0;
        let chunkUploaded = false;

        // Retry logic for this chunk
        while (!chunkUploaded && retries <= this.config.maxRetries) {
          try {
            await this.uploadChunk(
              uploadId,
              workspaceId,
              userId,
              file.name,
              chunk,
              chunkIndex,
              totalChunks,
              abortController.signal,
              (loaded, total) => {
                const now = Date.now();
                // Throttle updates to avoid overwhelming the UI
                if (now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL) {
                  return;
                }
                lastProgressUpdate = now;

                // Progress within current chunk
                const chunkProgress = (loaded / total) * 100;
                const bytesUploadedSoFar = totalBytesUploaded + loaded;
                const overallProgress = (bytesUploadedSoFar / file.size) * 100;

                if (onProgress) {
                  onProgress({
                    chunkIndex,
                    totalChunks,
                    chunkProgress,
                    overallProgress,
                    bytesUploaded: bytesUploadedSoFar,
                    totalBytes: file.size,
                    currentChunkSize: chunkSize,
                  });
                }
              }
            );

            chunkUploaded = true;
            totalBytesUploaded += chunkSize;

            // Report chunk completion (always report completion)
            lastProgressUpdate = Date.now();
            if (onProgress) {
              onProgress({
                chunkIndex,
                totalChunks,
                chunkProgress: 100,
                overallProgress: (totalBytesUploaded / file.size) * 100,
                bytesUploaded: totalBytesUploaded,
                totalBytes: file.size,
                currentChunkSize: chunkSize,
              });
            }
          } catch (error) {
            retries++;
            if (retries > this.config.maxRetries) {
              throw new Error(
                `Failed to upload chunk ${chunkIndex + 1} after ${this.config.maxRetries} retries: ${error instanceof Error ? error.message : 'Unknown error'}`
              );
            }
            // Wait before retry (exponential backoff)
            await new Promise((resolve) =>
              setTimeout(resolve, Math.pow(2, retries) * 1000)
            );
          }
        }
      }

      // All chunks uploaded successfully
      // Fetch the final upload record from the server
      const upload = await this.uploadMutator.getById(uploadId);
      if (!upload) {
        throw new Error('Upload record not found after completion');
      }

      return upload;
    } finally {
      this.abortControllers.delete(uploadId);
    }
  }

  /**
   * Cancel an in-progress upload
   */
  cancelUpload(uploadId: string): void {
    const controller = this.abortControllers.get(uploadId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(uploadId);
    }
  }

  /**
   * Create an upload record (status: queued)
   * This is called before starting the chunked upload
   */
  async createUploadRecord(
    workspaceId: string,
    file: File,
    userId: string
  ): Promise<Upload> {
    return this.uploadMutator.create({
      name: file.name,
      size: file.size,
      status: UploadStatus.QUEUED,
      bytesUploaded: 0,
      WorkspaceRef: workspaceId,
      UserRef: userId,
    });
  }
}
