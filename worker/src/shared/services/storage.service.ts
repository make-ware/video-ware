import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createStorageBackend,
  LocalStorageBackend,
  StorageBackend,
  StorageConfig,
} from '@project/shared/storage';
import { StorageBackendType, FileSource, FileType } from '@project/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

/**
 * Parameters for resolving a file path from storage
 */
export interface ResolveFilePathParams {
  /** Storage path (e.g., "uploads/workspace/upload/original.mp4") */
  storagePath: string;
  /** Storage backend type - if not provided, uses the configured backend or fileSource */
  storageBackend?: StorageBackendType;
  /** File source enum (alternative to storageBackend, for File records) */
  fileSource?: FileSource;
  /** Optional record ID for temp file naming when downloading from remote storage */
  recordId?: string;
}

/**
 * Parameters for generating a derived storage path
 */
export interface GenerateDerivedPathParams {
  /** Base storage path to derive from (e.g., "uploads/workspace/upload/original.mp4") */
  baseStoragePath?: string;
  /** Workspace ID - used if baseStoragePath is not provided */
  workspaceId?: string;
  /** Record ID (upload ID, timeline ID, etc.) - used if baseStoragePath is not provided */
  recordId?: string;
  /** Suffix for the derived file (e.g., "thumbnail", "sprite", "proxy") */
  suffix: string;
  /** File extension (e.g., "jpg", "mp4") */
  extension: string;
}

/**
 * Live-record keep-sets for reconcileLocal(). Each set holds the directory keys
 * that should be KEPT; any on-disk dir not in its set is purged.
 */
export interface LocalReconcileKeep {
  /** Keep uploads/{ws}/{uploadId} when uploadId is here (upload ids that have a Media). */
  uploadIds: Set<string>;
  /** Keep labels/{ws}/{mediaId} when mediaId is here (live Media ids). */
  mediaIds: Set<string>;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private backend!: StorageBackend;
  private resolvedBasePath!: string;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeBackend();
  }

  private async initializeBackend() {
    const storageType = this.configService.get<string>(
      'storage.type',
      'local'
    ) as StorageBackendType;

    const config: StorageConfig = {
      type: storageType,
    };

    if (storageType === StorageBackendType.LOCAL) {
      const localPath = this.configService.get<string>(
        'storage.localPath',
        './data'
      );
      config.local = {
        basePath: localPath,
      };
      // Resolve the base path relative to project root
      this.resolvedBasePath = this.resolveBasePath(localPath);
    } else if (storageType === StorageBackendType.S3) {
      // For S3, we still need a local path for temp/working files
      const localPath = this.configService.get<string>(
        'storage.localPath',
        './data'
      );
      // Resolve the base path relative to project root
      this.resolvedBasePath = this.resolveBasePath(localPath);
      const s3Bucket = this.configService.get<string>('storage.s3Bucket');
      const s3Region = this.configService.get<string>('storage.s3Region');
      const s3Endpoint = this.configService.get<string>('storage.s3Endpoint');
      const s3AccessKeyId = this.configService.get<string>(
        'storage.s3AccessKeyId'
      );
      const s3SecretAccessKey = this.configService.get<string>(
        'storage.s3SecretAccessKey'
      );
      const s3ForcePathStyle = this.configService.get<boolean>(
        'storage.s3ForcePathStyle',
        false
      );

      if (!s3Bucket || !s3Region || !s3AccessKeyId || !s3SecretAccessKey) {
        throw new Error(
          'S3 storage configuration is incomplete. Please check S3 environment variables.'
        );
      }

      config.s3 = {
        endpoint: s3Endpoint || `https://s3.${s3Region}.amazonaws.com`,
        bucket: s3Bucket,
        region: s3Region,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        forcePathStyle: s3ForcePathStyle,
      };
    }

    try {
      this.backend = await createStorageBackend(config);
      this.logger.log(`Initialized storage backend: ${storageType}`);

      // If S3 is enabled AND migration is explicitly opted into, migrate any
      // files that still live on local disk. This is off by default: stateless
      // S3 worker pods should not scan a (usually empty) local dir on every
      // boot. Operators set ENABLE_S3_MIGRATION=true for a one-time migration.
      if (
        storageType === StorageBackendType.S3 &&
        process.env.ENABLE_S3_MIGRATION === 'true'
      ) {
        await this.migrateLocalToS3();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to initialize storage backend: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Migrate files from local storage to S3 if they exist locally but not in S3
   */
  private async migrateLocalToS3() {
    try {
      const localPath = this.configService.get<string>(
        'storage.localPath',
        './data'
      );

      // Check if local storage directory exists
      if (!fs.existsSync(localPath)) {
        this.logger.log(
          `No local storage directory found at ${localPath}, skipping migration`
        );
        return;
      }

      this.logger.log(
        'Checking for files to migrate from local storage to S3...'
      );

      // Create a temporary local backend to list files
      const localBackend = new LocalStorageBackend({
        basePath: localPath,
      });
      await localBackend.initialize();

      // List all files in local storage
      // We use an empty prefix to list from the root of the storage directory
      const localFiles = await localBackend.listFiles('');

      if (localFiles.length === 0) {
        this.logger.log('No local files found to migrate');
        return;
      }

      this.logger.log(
        `Found ${localFiles.length} files in local storage. Starting migration...`
      );

      let migratedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const file of localFiles) {
        try {
          // Check if file already exists in S3
          const existsInS3 = await this.backend.exists(file.key);

          if (existsInS3) {
            skippedCount++;
            continue;
          }

          this.logger.debug(`Migrating ${file.key} to S3...`);

          // Read file from local using the local backend
          const fileStream = await localBackend.download(file.key);

          // Upload to S3
          await this.backend.upload(fileStream, file.key);

          migratedCount++;
        } catch (err) {
          errorCount++;
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to migrate ${file.key}: ${errorMessage}`);
        }
      }

      this.logger.log(
        `Migration complete. Migrated: ${migratedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Migration failed: ${errorMessage}`);
      // We don't throw here to allow the service to continue starting up
      // ignoring the migration failure
    }
  }

  /**
   * Map FileSource enum to StorageBackendType
   */
  private mapFileSourceToStorageBackend(
    fileSource: FileSource
  ): StorageBackendType {
    switch (fileSource) {
      case FileSource.S3:
        return StorageBackendType.S3;
      case FileSource.POCKETBASE:
        return StorageBackendType.LOCAL;
      case FileSource.GCS:
        // GCS not directly supported, but treat as S3-compatible
        return StorageBackendType.S3;
      default:
        throw new Error(`Unsupported file source: ${fileSource}`);
    }
  }

  /**
   * Resolve file path for processing - downloads from S3 to temp if needed
   * Returns local file path that can be used by FFmpeg and other tools
   *
   * @param params - Parameters containing storage path, backend type, and optional record ID
   * @returns Local filesystem path to the file
   */
  async resolveFilePath(params: ResolveFilePathParams): Promise<string> {
    const { storagePath, storageBackend, recordId } = params;

    if (!storagePath) {
      throw new Error('Storage path is required');
    }

    let backendType: StorageBackendType;
    if (storageBackend) {
      backendType = storageBackend;
    } else if ('fileSource' in params && params.fileSource) {
      // Support FileSource enum from File records
      backendType = this.mapFileSourceToStorageBackend(
        params.fileSource as FileSource
      );
    } else {
      backendType = this.backend.type;
    }

    // For local storage, return the resolved path directly
    if (backendType === StorageBackendType.LOCAL) {
      if (this.backend.type === StorageBackendType.LOCAL) {
        // Use the backend's resolvePath method for local storage
        return (this.backend as LocalStorageBackend).resolvePath(storagePath);
      }
      // Fallback for legacy configuration
      const localPath = this.configService.get<string>(
        'storage.localPath',
        './data'
      );
      return path.resolve(localPath, storagePath);
    }

    // For S3 storage, download to temporary file
    if (backendType === StorageBackendType.S3) {
      const tempRecordId = recordId || 'unknown';
      return await this.downloadToTemp(storagePath, tempRecordId);
    }

    throw new Error(`Unsupported storage type: ${backendType}`);
  }

  /**
   * Download file from S3 to temporary location for processing
   */
  private async downloadToTemp(
    storagePath: string,
    recordId: string
  ): Promise<string> {
    try {
      // Check if file exists in storage
      const exists = await this.backend.exists(storagePath);
      if (!exists) {
        throw new Error(`File not found in storage: ${storagePath}`);
      }

      // Create temp directory
      const tempDir = path.join(os.tmpdir(), 'worker-temp', recordId);
      await fs.promises.mkdir(tempDir, { recursive: true });

      // Generate temp file path
      const fileName = path.basename(storagePath);
      const tempFilePath = path.join(tempDir, fileName);

      // Check if already downloaded
      if (fs.existsSync(tempFilePath)) {
        this.logger.log(`Using cached temp file: ${tempFilePath}`);
        return tempFilePath;
      }

      // Download file. Stream to disk via pipeline() for backpressure: it
      // pauses the source whenever the disk write buffer is full, so a fast
      // source (S3 over LAN) feeding a slow disk can't accumulate the
      // difference in process memory. Write to a .part file and rename so the
      // "already downloaded" check above never picks up a partial download
      // left behind by a failed or interrupted attempt.
      this.logger.log(`Downloading ${storagePath} to ${tempFilePath}`);
      const stream = await this.backend.download(storagePath);
      const partFilePath = `${tempFilePath}.part`;

      try {
        await pipeline(
          Readable.fromWeb(stream as unknown as WebReadableStream),
          fs.createWriteStream(partFilePath)
        );
        await fs.promises.rename(partFilePath, tempFilePath);
      } catch (error) {
        await fs.promises.rm(partFilePath, { force: true });
        throw error;
      }

      this.logger.log(
        `Downloaded ${storagePath} to temp file: ${tempFilePath}`
      );
      return tempFilePath;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to download ${storagePath} to temp: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Upload file to storage
   */
  async upload(
    storagePath: string,
    data: Buffer | ReadableStream
  ): Promise<void> {
    try {
      await this.backend.upload(data, storagePath);
      this.logger.log(`Uploaded file to storage: ${storagePath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to upload ${storagePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Download file from storage
   */
  async download(storagePath: string): Promise<ReadableStream> {
    try {
      return await this.backend.download(storagePath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to download ${storagePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Check if file exists in storage
   */
  async exists(storagePath: string): Promise<boolean> {
    try {
      return await this.backend.exists(storagePath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to check existence of ${storagePath}: ${errorMessage}`
      );
      return false;
    }
  }

  /**
   * Delete file from storage
   */
  async delete(storagePath: string): Promise<void> {
    try {
      await this.backend.delete(storagePath);
      this.logger.log(`Deleted file from storage: ${storagePath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete ${storagePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Cleanup local file if storage backend is S3
   * If backend is LOCAL, this is a no-op (to preserve files in local storage)
   */
  async cleanup(localPath: string): Promise<void> {
    // Only cleanup if we are using S3 backend
    // If using Local backend, the "localPath" is likely the actual storage path, so we keep it
    if (this.backend.type === StorageBackendType.S3) {
      try {
        if (fs.existsSync(localPath)) {
          await fs.promises.unlink(localPath);
          this.logger.debug(`Cleaned up local file: ${localPath}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to cleanup ${localPath}: ${errorMessage}`);
      }
    }
  }

  /**
   * Get URL for file access
   */
  async getUrl(storagePath: string, expirySeconds?: number): Promise<string> {
    try {
      return await this.backend.getUrl(storagePath, expirySeconds);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get URL for ${storagePath}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * List files with prefix
   */
  async listFiles(prefix: string) {
    try {
      return await this.backend.listFiles(prefix);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to list files with prefix ${prefix}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Clean up temporary files for a record
   */
  async cleanupTemp(recordId: string): Promise<void> {
    try {
      const tempDir = path.join(os.tmpdir(), 'worker-temp', recordId);
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up temp directory: ${tempDir}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to cleanup temp directory for ${recordId}: ${errorMessage}`
      );
    }
  }

  /**
   * Remove the deterministic render working directory for a task (inputs,
   * output, and any ffmpeg scratch). A render's durable copy lives in
   * PocketBase (FileSource.POCKETBASE) or S3 — never in this local `renders/`
   * tree — so once the render is finalized the whole directory is disposable on
   * every backend. Best-effort: failures are logged, not thrown.
   */
  async cleanupRenderDir(workspaceId: string, taskId: string): Promise<void> {
    try {
      const renderDir = this.getRenderDir(workspaceId, taskId);
      if (fs.existsSync(renderDir)) {
        await fs.promises.rm(renderDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up render directory: ${renderDir}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to cleanup render directory for ${taskId}: ${errorMessage}`
      );
    }
  }

  /**
   * Remove the local working directory for a transcoded upload (proxy, audio,
   * sprite, thumbnail, filmstrip). These derived outputs are uploaded to
   * PocketBase (and tracked as File records) during each transcode step, so the
   * durable copy never lives in this local `transcode/` tree — once the task is
   * done the whole directory is disposable on every backend. The per-step
   * cleanup only deletes in S3 mode (no-op locally), so without this the
   * `transcode/{ws}/{uploadId}` dir would leak on the local backend.
   * Best-effort: failures are logged, not thrown.
   */
  async cleanupTranscodeDir(
    workspaceId: string,
    uploadId: string
  ): Promise<void> {
    try {
      const transcodeDir = path.join(
        this.resolvedBasePath,
        'transcode',
        workspaceId,
        uploadId
      );
      if (fs.existsSync(transcodeDir)) {
        await fs.promises.rm(transcodeDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up transcode directory: ${transcodeDir}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to cleanup transcode directory for ${uploadId}: ${errorMessage}`
      );
    }
  }

  /**
   * Remove stale worker working directories left behind by crashed/interrupted
   * tasks. Sweeps `os.tmpdir()/worker-temp/*` and the `renders/*` working dirs
   * on every backend — a render's durable copy lives in PocketBase/S3, so the
   * local renders tree is always disposable (see cleanupRenderDir). A directory
   * is "stale" when its mtime is older than maxAgeMs, so in-flight tasks
   * (recently touched) are preserved.
   * Per-pod: only sees the local filesystem of the worker that runs it.
   * @param maxAgeMs Age threshold in milliseconds (e.g. 24h)
   * @returns number of directories removed
   */
  async cleanupStaleWorkingDirs(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    const sweep = async (parentDir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(parentDir, {
          withFileTypes: true,
        });
      } catch {
        return; // parent doesn't exist yet -> nothing to sweep
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(parentDir, entry.name);
        try {
          const stat = await fs.promises.stat(dir);
          if (stat.mtimeMs >= cutoff) continue; // recently active -> keep
          await fs.promises.rm(dir, { recursive: true, force: true });
          removed++;
          this.logger.log(`Removed stale working dir: ${dir}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to remove stale dir ${dir}: ${msg}`);
        }
      }
    };

    await sweep(path.join(os.tmpdir(), 'worker-temp'));

    // renders/<workspaceId>/<taskId>: always a working dir (durable copy lives
    // in PocketBase/S3), so sweep it on every backend. Sweep at the taskId
    // level under each workspace.
    const rendersRoot = path.join(this.resolvedBasePath, 'renders');
    let workspaces: fs.Dirent[];
    try {
      workspaces = await fs.promises.readdir(rendersRoot, {
        withFileTypes: true,
      });
    } catch {
      workspaces = [];
    }
    for (const ws of workspaces) {
      if (!ws.isDirectory()) continue;
      await sweep(path.join(rendersRoot, ws.name));
    }

    return removed;
  }

  /**
   * Reconcile the LOCAL storage tree against live PocketBase records and purge
   * orphaned directories (folder-level). No-op on the S3 backend, which would
   * require listing the whole bucket. Rules, keyed on each dir's owning record:
   *   - uploads/{ws}/{uploadId}:   purged when the upload has no Media
   *       (keep.uploadIds = upload ids that DO have a Media).
   *   - transcode/{ws}/{uploadId}: same rule as uploads — derived TRANSCODE
   *       outputs are regenerable, so they go when the upload has no Media.
   *   - labels/{ws}/{mediaId}:   purged when the Media is gone
   *       (keep.mediaIds = live Media ids) — never when the Media exists.
   * A dir whose mtime is younger than maxAgeMs is skipped so in-flight ingests
   * aren't deleted mid-write. The `renders/` tree is NOT reconciled here — it
   * holds disposable working dirs reclaimed by cleanupStaleWorkingDirs (mtime
   * based), since a render's durable copy lives in PocketBase/S3.
   * @returns number of directories purged
   */
  async reconcileLocal(
    keep: LocalReconcileKeep,
    maxAgeMs: number
  ): Promise<number> {
    if (this.backend.type !== StorageBackendType.LOCAL) {
      this.logger.debug('reconcileLocal: skipped (backend is not local)');
      return 0;
    }

    const cutoff = Date.now() - maxAgeMs;
    let purged = 0;

    const categories: Array<{
      top: string;
      keepDir: (ws: string, id: string) => boolean;
    }> = [
      { top: 'uploads', keepDir: (_ws, id) => keep.uploadIds.has(id) },
      { top: 'transcode', keepDir: (_ws, id) => keep.uploadIds.has(id) },
      { top: 'labels', keepDir: (_ws, id) => keep.mediaIds.has(id) },
    ];

    for (const cat of categories) {
      const root = path.join(this.resolvedBasePath, cat.top);
      let workspaces: fs.Dirent[];
      try {
        workspaces = await fs.promises.readdir(root, { withFileTypes: true });
      } catch {
        continue; // category dir doesn't exist yet
      }

      for (const ws of workspaces) {
        if (!ws.isDirectory()) continue;
        const wsDir = path.join(root, ws.name);
        let ids: fs.Dirent[];
        try {
          ids = await fs.promises.readdir(wsDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const id of ids) {
          if (!id.isDirectory()) continue;
          if (cat.keepDir(ws.name, id.name)) continue;
          const dir = path.join(wsDir, id.name);
          try {
            const stat = await fs.promises.stat(dir);
            if (stat.mtimeMs >= cutoff) continue; // possibly in-flight -> keep
            await fs.promises.rm(dir, { recursive: true, force: true });
            purged++;
            this.logger.log(`Purged orphaned ${cat.top} dir: ${dir}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to purge ${dir}: ${msg}`);
          }
        }

        // Best-effort: drop the workspace dir if it's now empty.
        try {
          const remaining = await fs.promises.readdir(wsDir);
          if (remaining.length === 0) await fs.promises.rmdir(wsDir);
        } catch {
          // ignore
        }
      }
    }

    return purged;
  }

  /**
   * Create temporary directory for processing
   */
  async createTempDir(taskId: string): Promise<string> {
    try {
      const tempDir = path.join(os.tmpdir(), 'worker-temp', taskId);
      await fs.promises.mkdir(tempDir, { recursive: true });
      this.logger.debug(`Created temp directory: ${tempDir}`);
      return tempDir;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to create temp directory for ${taskId}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Create a deterministic render output directory in ./data/renders/<taskId>/
   * Returns the directory path - caller should use consistent filename within
   */
  async createRenderDir(workspaceId: string, taskId: string): Promise<string> {
    try {
      const renderDir = path.join(
        this.resolvedBasePath,
        'renders',
        workspaceId,
        taskId
      );
      await fs.promises.mkdir(renderDir, { recursive: true });
      this.logger.debug(`Created render directory: ${renderDir}`);
      return renderDir;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to create render directory for ${taskId}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Get the deterministic render directory for a task
   * Path: ./data/renders/<taskId>/
   */
  getRenderDir(workspaceId: string, taskId: string): string {
    return path.join(this.resolvedBasePath, 'renders', workspaceId, taskId);
  }

  /**
   * Get the deterministic render inputs directory for a task
   * Path: ./data/renders/<taskId>/inputs/
   */
  getRenderInputsDir(workspaceId: string, taskId: string): string {
    return path.join(this.getRenderDir(workspaceId, taskId), 'inputs');
  }

  /**
   * Get the deterministic path for a specific input media file in a task
   * Path: ./data/renders/<taskId>/inputs/<mediaId>.<extension>
   */
  getRenderInputPath(
    workspaceId: string,
    taskId: string,
    mediaId: string,
    extension: string
  ): string {
    // Ensure extension doesn't have a leading dot
    const cleanExt = extension.startsWith('.') ? extension.slice(1) : extension;
    return path.join(
      this.getRenderInputsDir(workspaceId, taskId),
      `${mediaId}.${cleanExt}`
    );
  }

  /**
   * Get the deterministic render output path for a task
   * Path: ./data/renders/<taskId>/output.<format>
   */
  getRenderOutputPath(
    workspaceId: string,
    taskId: string,
    format: string
  ): string {
    // Ensure format doesn't have a leading dot
    const cleanFormat = format.startsWith('.') ? format.slice(1) : format;
    return path.join(
      this.getRenderDir(workspaceId, taskId),
      `output.${cleanFormat}`
    );
  }

  /**
   * Get the storage backend instance
   */
  getBackend(): StorageBackend {
    return this.backend;
  }

  /**
   * Resolve a (possibly relative) basePath to an absolute path.
   * Ensures paths resolve relative to project root, not the worker subdirectory.
   * This allows "./data" to resolve to project root's data/ whether running from
   * project root or worker/ subdirectory.
   * Prioritizes environment variables for Docker deployments:
   * 1. WORKER_DATA_DIR (explicit configuration)
   */
  private resolveBasePath(basePath: string): string {
    // Check for WORKER_DATA_DIR environment variable first (most explicit)
    if (process.env.WORKER_DATA_DIR) {
      return path.resolve(process.env.WORKER_DATA_DIR);
    }

    // If path is already absolute, use it as-is
    if (path.isAbsolute(basePath)) return basePath;

    const cwd = process.cwd();
    const basename = path.basename(cwd);

    // If running from worker/ subdirectory, resolve relative to parent (project root)
    if (
      basename === 'worker' ||
      cwd.endsWith('/worker') ||
      cwd.endsWith('\\worker')
    ) {
      // Remove "./" prefix if present for cleaner resolution
      const cleanPath = basePath.startsWith('./')
        ? basePath.slice(2)
        : basePath;
      return path.resolve(path.dirname(cwd), cleanPath);
    }

    // Otherwise resolve relative to current working directory (project root)
    return path.resolve(cwd, basePath);
  }

  /**
   * Get the base storage path for local storage
   * Returns the resolved path relative to project root
   */
  getBasePath(): string {
    // If we've already resolved it during initialization, return that
    if (this.resolvedBasePath) {
      return this.resolvedBasePath;
    }

    // Fallback if called before initialization
    const localPath = this.configService.get<string>(
      'storage.localPath',
      './data'
    );

    // Resolve the path
    return this.resolveBasePath(localPath);
  }

  /**
   * Storage key for a derived TRANSCODE output (proxy, audio, sprite, thumbnail,
   * filmstrip). These live under the `transcode/` top-level — kept separate from
   * the untouchable `uploads/` original — so the cleanup task can reclaim
   * regenerable data per BullMQ queue (delete `transcode/`, keep `uploads/`).
   * Layout: transcode/{workspaceId}/{uploadId}/{fileType}/{fileName}.
   */
  transcodeStorageKey(
    workspaceId: string,
    uploadId: string,
    fileType: FileType,
    fileName: string
  ): string {
    return `transcode/${workspaceId}/${uploadId}/${fileType}/${fileName}`;
  }

  /**
   * Generate storage path for derived files
   *
   * @param params - Parameters for generating the derived path
   * @returns Storage path for the derived file
   */
  generateDerivedPath(params: GenerateDerivedPathParams): string {
    const { baseStoragePath, workspaceId, recordId, suffix, extension } =
      params;

    let basePath: string;

    if (baseStoragePath) {
      // Use provided base path
      basePath = baseStoragePath;
    } else if (workspaceId && recordId) {
      // Construct path from workspace and record ID
      basePath = `uploads/${workspaceId}/${recordId}/original`;
    } else {
      throw new Error(
        'Either baseStoragePath or both workspaceId and recordId must be provided'
      );
    }

    const dir = path.dirname(basePath);
    return `${dir}/${suffix}.${extension}`;
  }
}
