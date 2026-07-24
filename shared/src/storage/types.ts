import { StorageBackendType } from '../enums';

/**
 * Configuration for local filesystem storage
 */
export interface LocalStorageConfig {
  basePath: string;
}

/**
 * Configuration for S3-compatible storage
 */
export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // For MinIO compatibility
}

/**
 * Combined storage configuration
 */
export interface StorageConfig {
  type: StorageBackendType;
  local?: LocalStorageConfig;
  s3?: S3StorageConfig;
}

/**
 * Result of a storage upload operation
 */
export interface StorageResult {
  path: string;
  size: number;
  etag?: string;
  lastModified?: Date;
}

/**
 * Represents a file in storage
 */
export interface StorageFile {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
}

/**
 * Presigned URL for direct uploads
 */
export interface PresignedUrl {
  url: string;
  fields?: Record<string, string>; // For POST-based uploads
  expiresAt: Date;
}

/**
 * Upload progress tracking
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  speed: number; // bytes per second
  estimatedTimeRemaining: number; // seconds
}

/**
 * Per-chunk parameters for chunked uploads.
 *
 * Chunks arrive as separate HTTP requests (often on different server
 * instances after a restart), so everything a backend needs to place the
 * chunk and finalize the file travels here rather than in backend state.
 */
export interface ChunkUploadOptions {
  /** Index of this chunk (0-based). */
  chunkIndex: number;
  /** Total number of chunks. */
  totalChunks: number;
  /** Whether this is the first chunk. */
  isFirstChunk: boolean;
  /** Whether this is the last chunk (triggers finalize + verification). */
  isLastChunk: boolean;
  /**
   * Exact byte length of this chunk when known. Lets backends stream the
   * chunk to its destination (S3 UploadPart needs a length up front) instead
   * of buffering it fully in memory first.
   */
  contentLength?: number;
  /**
   * Byte offset of this chunk within the final file. When present, the local
   * backend writes at this position (idempotent retries, parallel chunks);
   * absent, it falls back to sequential append.
   */
  offset?: number;
  /**
   * Expected size of the fully-assembled file. When present, finalization
   * verifies the stored object matches before reporting success.
   */
  expectedTotalSize?: number;
  /**
   * S3 multipart upload id, echoed back by the client from the first chunk's
   * response. Makes the chunk protocol stateless server-side: any instance
   * can accept any chunk, and uploads survive server restarts.
   */
  multipartUploadId?: string;
}

/**
 * Result of uploading one chunk.
 */
export interface ChunkUploadResult {
  /**
   * Backend upload session id (S3 multipart upload id). Returned on the
   * first chunk; clients echo it back via ChunkUploadOptions.multipartUploadId
   * on subsequent chunks.
   */
  multipartUploadId?: string;
  /** Final object metadata; present only once the last chunk finalized. */
  result?: StorageResult;
}

/**
 * Storage backend interface - all storage implementations must implement this
 */
export interface StorageBackend {
  readonly type: StorageBackendType;

  /**
   * Initialize the storage backend and validate configuration
   * Should be called before using any other methods
   */
  initialize(): Promise<void>;

  /**
   * Upload a file to storage
   * @param file - File, Buffer, or ReadableStream to upload
   * @param path - Destination path in storage
   * @param onProgress - Optional progress callback
   * @returns Storage result with path and metadata
   */
  upload(
    file: File | Buffer | ReadableStream,
    path: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageResult>;

  /**
   * Upload a chunk of a file (for chunked uploads)
   * @param chunk - ReadableStream of the chunk data
   * @param path - Destination path in storage
   * @param options - Chunk placement/finalization parameters
   * @returns Chunk result (upload session id on first chunk, final metadata on last)
   */
  uploadChunk(
    chunk: ReadableStream,
    path: string,
    options: ChunkUploadOptions
  ): Promise<ChunkUploadResult>;

  /**
   * Download a file from storage
   * @param path - Path to the file in storage
   * @returns ReadableStream of file contents
   */
  download(path: string): Promise<ReadableStream>;

  /**
   * Delete a file from storage
   * @param path - Path to the file to delete
   */
  delete(path: string): Promise<void>;

  /**
   * Move/rename a file within storage, overwriting the destination if it
   * already exists. Intended to be as close to atomic as the backend allows
   * (a filesystem rename locally, a server-side copy + delete on S3) so a
   * partially-written source can be promoted to its final location without
   * ever leaving the destination in a half-written state.
   * @param from - Source path
   * @param to - Destination path (overwritten if present)
   */
  move(from: string, to: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param path - Path to check
   * @returns true if file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get a URL to access the file
   * @param path - Path to the file
   * @param expirySeconds - Optional expiry time for signed URLs
   * @returns URL to access the file
   */
  getUrl(path: string, expirySeconds?: number): Promise<string>;

  /**
   * List files in storage with a given prefix
   * @param prefix - Prefix to filter files
   * @returns Array of storage files
   */
  listFiles(prefix: string): Promise<StorageFile[]>;

  /**
   * Get a presigned URL for direct browser uploads (S3 only)
   * @param path - Destination path for the upload
   * @param contentType - MIME type of the file
   * @param maxSize - Maximum file size in bytes
   * @param expirySeconds - URL expiry time in seconds
   * @returns Presigned URL details
   */
  getPresignedUploadUrl(
    path: string,
    contentType: string,
    maxSize: number,
    expirySeconds?: number
  ): Promise<PresignedUrl>;
}

/**
 * Generate a storage path for an upload
 * @param workspaceId - Workspace ID
 * @param uploadId - Upload ID
 * @param extension - File extension
 * @returns Storage path
 */
export function generateStoragePath(
  workspaceId: string,
  uploadId: string,
  extension: string
): string {
  return `uploads/${workspaceId}/${uploadId}/original.${extension}`;
}

/**
 * Generate a local filesystem path for an upload
 * @param basePath - Base storage directory
 * @param workspaceId - Workspace ID
 * @param uploadId - Upload ID
 * @param extension - File extension
 * @returns Full filesystem path
 */
export function generateLocalPath(
  basePath: string,
  workspaceId: string,
  uploadId: string,
  extension: string
): string {
  return `${basePath}/uploads/${workspaceId}/${uploadId}/original.${extension}`;
}
