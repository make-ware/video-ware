/**
 * Chunked Replace Service
 *
 * Uploads a replacement video for an EXISTING media/upload, overwriting the
 * stored original in place. Uses the same chunk protocol (and parallel middle
 * chunks) as {@link ChunkedUploadService} so large files survive proxy body
 * limits (e.g. Cloudflare Tunnel's 100MB cap), but it targets the dedicated
 * `/api-next/uploads/replace` route which assembles at a staging key, verifies
 * the result, promotes it onto the upload's existing `externalPath`, and —
 * critically — does NOT mutate the Upload record, so no re-ingest
 * (transcode + labels) is triggered.
 */

import type { TypedPocketBase } from '@project/shared';
import { driveChunkedTransfer } from './chunk-protocol';

/**
 * Configuration for chunked replace uploads
 */
export interface ChunkedReplaceConfig {
  chunkSize?: number; // Size of each chunk in bytes (default: 64MB)
  maxRetries?: number; // Max retries per chunk (default: 3)
  timeout?: number; // Timeout per chunk in ms (default: 10 minutes)
  concurrency?: number; // Middle chunks in flight at once (default: 3)
}

const DEFAULT_CONFIG: Required<ChunkedReplaceConfig> = {
  chunkSize: 64 * 1024 * 1024, // 64MB
  maxRetries: 3,
  timeout: 10 * 60 * 1000, // 10 minutes
  concurrency: 3,
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
    const abortController = new AbortController();
    this.abortControllers.set(uploadId, abortController);

    let lastProgressUpdate = 0;
    const PROGRESS_UPDATE_INTERVAL = 500; // ms

    try {
      await driveChunkedTransfer({
        pb: this.pb,
        url: '/api-next/uploads/replace',
        file,
        uploadId,
        workspaceId,
        userId,
        chunkSize: this.config.chunkSize,
        concurrency: this.config.concurrency,
        maxRetries: this.config.maxRetries,
        timeout: this.config.timeout,
        abortSignal: abortController.signal,
        onProgress: (progress) => {
          if (!onProgress) return;
          const chunkComplete = progress.chunkLoaded >= progress.chunk.length;
          const now = Date.now();
          if (
            !chunkComplete &&
            now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL
          ) {
            return;
          }
          lastProgressUpdate = now;
          onProgress(Math.min((progress.bytesUploaded / file.size) * 100, 100));
        },
      });
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
