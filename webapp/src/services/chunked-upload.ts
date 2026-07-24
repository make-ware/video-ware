/**
 * Chunked Upload Service
 *
 * Handles large file uploads by splitting them into chunks to bypass
 * proxy limits (e.g., Cloudflare Tunnel's 100MB limit).
 *
 * Features:
 * - Splits files into configurable chunk sizes (default: 64MB)
 * - First chunk alone, then middle chunks in parallel, last chunk alone
 *   (the shared chunk schedule — parallelism hides per-request latency)
 * - Per-chunk retry logic with exponential backoff
 * - Minimal database writes (only on completion)
 */

import type { TypedPocketBase } from '@project/shared';
import { UploadMutator } from '@project/shared/mutator';
import { UploadStatus } from '@project/shared';
import type { Upload } from '@project/shared';
import { driveChunkedTransfer } from './chunk-protocol';

/**
 * Progress callback for chunk uploads
 */
export interface ChunkProgress {
  chunkIndex: number; // Chunk the latest progress event came from (0-based)
  totalChunks: number; // Total number of chunks
  chunkProgress: number; // Progress within that chunk (0-100)
  overallProgress: number; // Overall upload progress (0-100)
  bytesUploaded: number; // Total bytes uploaded so far (all chunks)
  totalBytes: number; // Total file size
  currentChunkSize: number; // Size of that chunk
}

/**
 * Configuration for chunked uploads
 */
export interface ChunkedUploadConfig {
  chunkSize?: number; // Size of each chunk in bytes (default: 64MB)
  maxRetries?: number; // Max retries per chunk (default: 3)
  timeout?: number; // Timeout per chunk in ms (default: 10 minutes)
  concurrency?: number; // Middle chunks in flight at once (default: 3)
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ChunkedUploadConfig> = {
  // Comfortably under Cloudflare Tunnel's ~100MB request cap, and small
  // enough that parallel middle chunks overlap well on large files.
  chunkSize: 64 * 1024 * 1024, // 64MB
  maxRetries: 3,
  timeout: 10 * 60 * 1000, // 10 minutes
  concurrency: 1,
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
   * Upload a file in chunks
   */
  async uploadFile(
    uploadId: string,
    workspaceId: string,
    userId: string,
    file: File,
    onProgress?: (progress: ChunkProgress) => void,
    directoryId?: string
  ): Promise<Upload> {
    const abortController = new AbortController();
    this.abortControllers.set(uploadId, abortController);

    let lastProgressUpdate = 0;
    const PROGRESS_UPDATE_INTERVAL = 1000; // ms

    try {
      const response = await driveChunkedTransfer({
        pb: this.pb,
        url: '/api-next/uploads/upload',
        file,
        uploadId,
        workspaceId,
        userId,
        directoryId,
        chunkSize: this.config.chunkSize,
        concurrency: this.config.concurrency,
        maxRetries: this.config.maxRetries,
        timeout: this.config.timeout,
        abortSignal: abortController.signal,
        onProgress: (progress) => {
          if (!onProgress) return;
          const chunkComplete = progress.chunkLoaded >= progress.chunk.length;
          const now = Date.now();
          // Throttle in-flight updates to avoid overwhelming the UI, but
          // always report a chunk finishing.
          if (
            !chunkComplete &&
            now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL
          ) {
            return;
          }
          lastProgressUpdate = now;
          onProgress({
            chunkIndex: progress.chunk.index,
            totalChunks: progress.totalChunks,
            chunkProgress: (progress.chunkLoaded / progress.chunk.length) * 100,
            overallProgress: (progress.bytesUploaded / file.size) * 100,
            bytesUploaded: progress.bytesUploaded,
            totalBytes: file.size,
            currentChunkSize: progress.chunk.length,
          });
        },
      });

      // The route returns the finalized record on the completing chunk; fall
      // back to a fetch for older responses.
      const upload =
        response.upload ?? (await this.uploadMutator.getById(uploadId));
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
