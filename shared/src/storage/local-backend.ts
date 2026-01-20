import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createReadStream, createWriteStream } from 'fs';
import { StorageBackendType } from '../enums';
import type {
  StorageBackend,
  StorageResult,
  StorageFile,
  PresignedUrl,
  UploadProgress,
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
    this.resolvedBasePath = this.resolveBasePath(config.basePath);
  }

  /**
   * Resolve a (possibly relative) basePath to an absolute path.
   *
   * In a monorepo, different workspaces (webapp/worker) may run with different CWDs.
   * This searches upward from process.cwd() for a matching path.
   */
  private resolveBasePath(basePath: string): string {
    if (path.isAbsolute(basePath)) return basePath;

    // Best-effort upward search so "data" works from repo root or nested workspaces.
    let current = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.resolve(current, basePath);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // ignore
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    // Fallback: resolve relative to current working directory.
    return path.resolve(process.cwd(), basePath);
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
        // Handle ReadableStream
        const writeStream = createWriteStream(fullPath);
        const reader = file.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            uploadedSize += value.length;
            writeStream.write(value);

            if (onProgress && totalSize > 0) {
              const elapsed = (Date.now() - startTime) / 1000;
              const speed = elapsed > 0 ? uploadedSize / elapsed : 0;
              const remaining = totalSize - uploadedSize;
              const eta = speed > 0 ? remaining / speed : 0;

              onProgress({
                loaded: uploadedSize,
                total: totalSize,
                percentage: (uploadedSize / totalSize) * 100,
                speed,
                estimatedTimeRemaining: eta,
              });
            }
          }

          writeStream.end();
          await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });
        } finally {
          reader.releaseLock();
        }
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
   * Upload a chunk of a file (for chunked uploads)
   * Appends chunks to the file sequentially
   */
  async uploadChunk(
    chunk: ReadableStream,
    filePath: string,
    chunkIndex: number,
    totalChunks: number,
    isFirstChunk: boolean,
    isLastChunk: boolean
  ): Promise<StorageResult | void> {
    const fullPath = this.resolvePath(filePath);
    const directory = path.dirname(fullPath);

    // Ensure directory exists
    await mkdir(directory, { recursive: true });

    try {
      // For first chunk, create/overwrite file; for subsequent chunks, append
      const writeStream = isFirstChunk
        ? createWriteStream(fullPath)
        : createWriteStream(fullPath, { flags: 'a' });

      const reader = chunk.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writeStream.write(value);
        }

        writeStream.end();
        await new Promise<void>((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      } finally {
        reader.releaseLock();
      }

      // Only return result on last chunk
      if (isLastChunk) {
        const stats = await stat(fullPath);
        return {
          path: filePath,
          size: stats.size,
          lastModified: stats.mtime,
        };
      }
    } catch (error) {
      // Clean up partial file on error
      try {
        await unlink(fullPath);
      } catch {
        // Ignore cleanup errors
      }

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
