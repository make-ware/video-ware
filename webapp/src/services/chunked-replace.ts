/**
 * Chunked Replace Service
 *
 * Uploads a replacement video for an EXISTING media/upload, overwriting the
 * stored original in place. Mirrors {@link ChunkedUploadService}'s chunking so
 * large files survive proxy body limits (e.g. Cloudflare Tunnel's 100MB cap),
 * but it targets the dedicated `/api-next/uploads/replace` route which writes
 * to the upload's existing `externalPath` and — critically — does NOT mutate
 * the Upload record, so no re-ingest (transcode + labels) is triggered.
 */

import type { TypedPocketBase } from '@project/shared';

/**
 * Configuration for chunked replace uploads
 */
export interface ChunkedReplaceConfig {
  chunkSize?: number; // Size of each chunk in bytes (default: 100MB)
  maxRetries?: number; // Max retries per chunk (default: 3)
  timeout?: number; // Timeout per chunk in ms (default: 10 minutes)
}

const DEFAULT_CONFIG: Required<ChunkedReplaceConfig> = {
  chunkSize: 100 * 1024 * 1024, // 100MB
  maxRetries: 3,
  timeout: 10 * 60 * 1000, // 10 minutes
};

export class ChunkedReplaceService {
  private pb: TypedPocketBase;
  private config: Required<ChunkedReplaceConfig>;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(pb: TypedPocketBase, config?: ChunkedReplaceConfig) {
    this.pb = pb;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Send a single chunk to the replace endpoint.
   */
  private uploadChunk(
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

      const abortHandler = () => {
        xhr.abort();
        reject(new Error('Replace cancelled'));
      };
      abortSignal.addEventListener('abort', abortHandler);

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
        reject(new Error('User must be authenticated to replace files'));
        return;
      }

      xhr.open('PUT', '/api-next/uploads/replace');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('x-upload-id', uploadId);
      xhr.setRequestHeader('x-workspace-id', workspaceId);
      xhr.setRequestHeader('x-user-id', userId);
      xhr.setRequestHeader('x-file-name', fileName);
      xhr.setRequestHeader('x-chunk-index', chunkIndex.toString());
      xhr.setRequestHeader('x-total-chunks', totalChunks.toString());
      xhr.timeout = this.config.timeout;

      xhr.send(chunk);
    });
  }

  /**
   * Replace the stored original of an upload with a new file, in chunks.
   *
   * @param uploadId The upload whose original is being replaced
   * @param workspaceId The workspace ID
   * @param userId The requesting user ID
   * @param file The replacement file
   * @param onProgress Overall progress callback (0-100)
   */
  async replaceFile(
    uploadId: string,
    workspaceId: string,
    userId: string,
    file: File,
    onProgress?: (overallProgress: number) => void
  ): Promise<void> {
    const totalChunks = Math.ceil(file.size / this.config.chunkSize);
    const abortController = new AbortController();
    this.abortControllers.set(uploadId, abortController);

    try {
      let totalBytesUploaded = 0;
      let lastProgressUpdate = 0;
      const PROGRESS_UPDATE_INTERVAL = 500; // ms

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * this.config.chunkSize;
        const end = Math.min(start + this.config.chunkSize, file.size);
        const chunk = file.slice(start, end);
        const chunkSize = chunk.size;

        let retries = 0;
        let chunkUploaded = false;

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
              (loaded) => {
                const now = Date.now();
                if (now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL) {
                  return;
                }
                lastProgressUpdate = now;
                const overall =
                  ((totalBytesUploaded + loaded) / file.size) * 100;
                onProgress?.(Math.min(overall, 100));
              }
            );

            chunkUploaded = true;
            totalBytesUploaded += chunkSize;
            onProgress?.((totalBytesUploaded / file.size) * 100);
          } catch (error) {
            // Abort is terminal — don't retry a user-cancelled replace.
            if (abortController.signal.aborted) {
              throw error;
            }
            retries++;
            if (retries > this.config.maxRetries) {
              throw new Error(
                `Failed to upload chunk ${chunkIndex + 1} after ${this.config.maxRetries} retries: ${error instanceof Error ? error.message : 'Unknown error'}`
              );
            }
            await new Promise((resolve) =>
              setTimeout(resolve, Math.pow(2, retries) * 1000)
            );
          }
        }
      }
    } finally {
      this.abortControllers.delete(uploadId);
    }
  }

  /**
   * Cancel an in-progress replace.
   */
  cancelReplace(uploadId: string): void {
    const controller = this.abortControllers.get(uploadId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(uploadId);
    }
  }
}
