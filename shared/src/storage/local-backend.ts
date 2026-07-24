import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { StorageBackendType } from '../enums';
import { resolveLocalStorageBasePath } from './base-path';
import type {
  StorageBackend,
  StorageResult,
  StorageFile,
  PresignedUrl,
  UploadProgress,
  ChunkUploadOptions,
  ChunkUploadResult,
  LocalStorageConfig,
} from './types';

const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const access = promisify(fs.access);
const readdir = promisify(fs.readdir);

/**
 * Local filesystem storage backend implementation
 */
export class LocalStorageBackend implements StorageBackend {
  readonly type = StorageBackendType.LOCAL;
  private readonly basePath: string;
  private readonly resolvedBasePath: string;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
    this.resolvedBasePath = resolveLocalStorageBasePath(config.basePath);
  }

  /**
   * The absolute base directory all storage keys resolve under. Exposed so
   * callers that build local filesystem paths directly (e.g. the worker's
   * StorageService) use the exact same resolution as this backend instead of
   * re-deriving it.
   */
  getResolvedBasePath(): string {
    return this.resolvedBasePath;
  }

  /**
   * Resolve a storage key/path (e.g. "uploads/<ws>/<upload>/original.mov")
   * into an absolute local filesystem path under the resolved base directory.
   *
   * Also guards against path traversal (e.g. "../../etc/passwd").
   */
  resolvePath(filePath: string): string {
    const normalized = path.normalize(filePath).replace(/^([/\\])+/, '');
    if (
      normalized === '' ||
      normalized === '.' ||
      normalized.startsWith('..') ||
      normalized.includes(`..${path.sep}`)
    ) {
      throw new Error(`Invalid storage path: ${filePath}`);
    }

    const fullPath = path.resolve(this.resolvedBasePath, normalized);
    const baseResolved = path.resolve(this.resolvedBasePath);
    if (
      fullPath !== baseResolved &&
      !fullPath.startsWith(baseResolved + path.sep)
    ) {
      throw new Error(`Invalid storage path (escapes basePath): ${filePath}`);
    }

    return fullPath;
  }

  /**
   * Initialize the storage backend and validate permissions
   */
  async initialize(): Promise<void> {
    try {
      // Ensure base directory exists
      await mkdir(this.resolvedBasePath, { recursive: true });

      // Validate write permissions
      await access(
        this.resolvedBasePath,
        fs.constants.W_OK | fs.constants.R_OK
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize local storage at ${this.resolvedBasePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Upload a file to local storage
   */
  async upload(
    file: File | Buffer | ReadableStream,
    filePath: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageResult> {
    const fullPath = this.resolvePath(filePath);
    const directory = path.dirname(fullPath);

    // Ensure directory exists
    await mkdir(directory, { recursive: true });

    let totalSize = 0;
    let uploadedSize = 0;
    const startTime = Date.now();

    try {
      if (file instanceof Buffer) {
        // Handle Buffer
        totalSize = file.length;
        await fs.promises.writeFile(fullPath, file);
        uploadedSize = totalSize;

        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          onProgress({
            loaded: uploadedSize,
            total: totalSize,
            percentage: 100,
            speed: elapsed > 0 ? uploadedSize / elapsed : 0,
            estimatedTimeRemaining: 0,
          });
        }
      } else if (file instanceof ReadableStream) {
        // Handle ReadableStream. pipeline() applies backpressure: it pauses
        // the source whenever the disk write buffer is full, so a fast source
        // feeding a slow disk can't accumulate the difference in process
        // memory. No progress reporting here — a stream's total size is
        // unknown, and onProgress requires a total to compute percentage.
        await pipeline(
          Readable.fromWeb(file as unknown as WebReadableStream),
          createWriteStream(fullPath)
        );
      } else {
        // Handle File (browser environment)
        totalSize = (file as File).size;
        const buffer = Buffer.from(await (file as File).arrayBuffer());
        await fs.promises.writeFile(fullPath, buffer);
        uploadedSize = totalSize;

        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          onProgress({
            loaded: uploadedSize,
            total: totalSize,
            percentage: 100,
            speed: elapsed > 0 ? uploadedSize / elapsed : 0,
            estimatedTimeRemaining: 0,
          });
        }
      }

      // Get file stats
      const stats = await stat(fullPath);

      return {
        path: filePath,
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (error) {
      // Clean up partial file on error
      try {
        await unlink(fullPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(
        `Failed to upload file to ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Upload a chunk of a file (for chunked uploads).
   *
   * When the chunk carries its byte offset (options.offset), it is written at
   * that position: retries simply rewrite the same range (idempotent) and
   * chunks may arrive in parallel, since their ranges are disjoint. Without an
   * offset (older clients) chunks append sequentially; a failed append is
   * rolled back by truncating to the pre-write length so the client's retry
   * of the SAME chunk appends cleanly. In neither case is the partially
   * assembled file deleted on error — earlier chunks stay valid for retries.
   *
   * pipeline() applies backpressure throughout so a fast client upload can't
   * outrun the disk and pile up in process memory.
   */
  async uploadChunk(
    chunk: ReadableStream,
    filePath: string,
    options: ChunkUploadOptions
  ): Promise<ChunkUploadResult> {
    const { chunkIndex, totalChunks, isFirstChunk, isLastChunk } = options;
    const fullPath = this.resolvePath(filePath);
    const directory = path.dirname(fullPath);

    // Ensure directory exists
    await mkdir(directory, { recursive: true });

    try {
      const source = Readable.fromWeb(chunk as unknown as WebReadableStream);

      if (options.offset !== undefined) {
        // Positioned write. The first chunk creates/truncates the file (so a
        // restarted upload never inherits stale trailing bytes); later chunks
        // require it to exist ('r+') — a missing file means the first chunk
        // never landed, which must surface as an error, not a sparse file.
        const writeStream = isFirstChunk
          ? createWriteStream(fullPath, { flags: 'w', start: options.offset })
          : createWriteStream(fullPath, { flags: 'r+', start: options.offset });
        await pipeline(source, writeStream);
      } else if (isFirstChunk) {
        await pipeline(source, createWriteStream(fullPath));
      } else {
        // Sequential append (older clients). Remember the pre-append length
        // so a partial write can be rolled back for a clean retry.
        const priorSize = (await stat(fullPath)).size;
        try {
          await pipeline(source, createWriteStream(fullPath, { flags: 'a' }));
        } catch (appendError) {
          await fs.promises.truncate(fullPath, priorSize).catch(() => {
            // Best-effort rollback; the size check at finalize is the backstop.
          });
          throw appendError;
        }
      }

      if (!isLastChunk) {
        return {};
      }

      // Finalize: verify the assembled file is exactly the declared size
      // before reporting success, so truncated or mis-assembled uploads are
      // caught here instead of failing later in the ingest pipeline.
      const stats = await stat(fullPath);
      if (
        options.expectedTotalSize !== undefined &&
        stats.size !== options.expectedTotalSize
      ) {
        throw new Error(
          `assembled file is ${stats.size} bytes but ` +
            `${options.expectedTotalSize} bytes were expected — upload is corrupt`
        );
      }
      return {
        result: {
          path: filePath,
          size: stats.size,
          lastModified: stats.mtime,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to upload chunk ${chunkIndex + 1}/${totalChunks} to ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Download a file from local storage
   */
  async download(filePath: string): Promise<ReadableStream> {
    const fullPath = this.resolvePath(filePath);

    try {
      // Check if file exists
      await access(fullPath, fs.constants.R_OK);

      // Create read stream
      const readStream = createReadStream(fullPath);

      // Convert Node.js ReadableStream to Web ReadableStream
      return new ReadableStream({
        start(controller) {
          readStream.on('data', (chunk: Buffer | string) => {
            const uint8Array =
              chunk instanceof Buffer
                ? new Uint8Array(chunk)
                : new Uint8Array(Buffer.from(chunk));
            controller.enqueue(uint8Array);
          });

          readStream.on('end', () => {
            controller.close();
          });

          readStream.on('error', (error) => {
            controller.error(error);
          });
        },
        cancel() {
          readStream.destroy();
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to download file from ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Delete a file from local storage
   */
  async delete(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);

    try {
      await unlink(fullPath);

      // Try to remove empty parent directories
      const directory = path.dirname(fullPath);
      try {
        await fs.promises.rmdir(directory);
        // Try to remove workspace directory if empty
        const workspaceDir = path.dirname(directory);
        await fs.promises.rmdir(workspaceDir);
      } catch {
        // Ignore errors when removing directories (they might not be empty)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, consider it deleted
        return;
      }

      throw new Error(
        `Failed to delete file at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Move/rename a file within local storage, overwriting the destination.
   * Uses fs.rename, which is atomic on the same filesystem, so the destination
   * is either the old file or the fully-moved new file — never a partial write.
   */
  async move(fromPath: string, toPath: string): Promise<void> {
    const fromFull = this.resolvePath(fromPath);
    const toFull = this.resolvePath(toPath);

    try {
      // Ensure the destination directory exists.
      await mkdir(path.dirname(toFull), { recursive: true });
      await fs.promises.rename(fromFull, toFull);
    } catch (error) {
      throw new Error(
        `Failed to move file from ${fromPath} to ${toPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Check if a file exists in local storage
   */
  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);

    try {
      await access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a URL to access the file
   * For local storage, this returns a file:// URL
   */
  async getUrl(filePath: string, _expirySeconds?: number): Promise<string> {
    const fullPath = this.resolvePath(filePath);

    // Check if file exists
    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Return file:// URL
    return `file://${fullPath}`;
  }

  /**
   * List files in local storage with a given prefix
   */
  async listFiles(prefix: string): Promise<StorageFile[]> {
    const fullPrefix = this.resolvePath(prefix);
    const files: StorageFile[] = [];

    try {
      await this.listFilesRecursive(fullPrefix, this.resolvedBasePath, files);
      return files;
    } catch (error) {
      throw new Error(
        `Failed to list files with prefix ${prefix}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Recursively list files in a directory
   */
  private async listFilesRecursive(
    directory: string,
    basePath: string,
    files: StorageFile[]
  ): Promise<void> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await this.listFilesRecursive(fullPath, basePath, files);
        } else if (entry.isFile()) {
          const stats = await stat(fullPath);
          const relativePath = path.relative(basePath, fullPath);

          files.push({
            key: relativePath.replace(/\\/g, '/'), // Normalize path separators
            size: stats.size,
            etag: `${stats.mtime.getTime()}-${stats.size}`, // Simple ETag based on mtime and size
            lastModified: stats.mtime,
          });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist, return empty list
        return;
      }
      throw error;
    }
  }

  /**
   * Get a presigned URL for direct browser uploads
   * Not supported for local storage - throws error
   */
  async getPresignedUploadUrl(
    _path: string,
    _contentType: string,
    _maxSize: number,
    _expirySeconds?: number
  ): Promise<PresignedUrl> {
    throw new Error(
      'Presigned upload URLs are not supported for local storage backend'
    );
  }
}
