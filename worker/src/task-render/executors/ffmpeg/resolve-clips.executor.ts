import { Injectable, Logger } from '@nestjs/common';
import { PocketBaseService } from '../../../shared/services/pocketbase.service';
import { StorageService } from '../../../shared/services/storage.service';
import type { IPrepareExecutor, ResolveClipsResult } from '../interfaces';
import { StorageBackendType } from '@project/shared';
import type { RenderTimelinePayload, Media } from '@project/shared';
import * as fs from 'fs';
import * as path from 'path';

/**
 * FFmpeg-based executor for resolving clip media files
 * Pure operation - resolves file paths for timeline clips
 */
@Injectable()
export class FFmpegResolveClipsExecutor implements IPrepareExecutor {
  private readonly logger = new Logger(FFmpegResolveClipsExecutor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {}

  async execute(
    timelineId: string,
    tracks: RenderTimelinePayload['tracks']
  ): Promise<ResolveClipsResult> {
    this.logger.log(`Resolving media for timeline ${timelineId} render`);

    // Extract all unique media IDs from the tracks
    const mediaIds = new Set<string>();
    for (const track of tracks) {
      for (const segment of track.segments) {
        if (segment.assetId) {
          mediaIds.add(segment.assetId);
        }
      }
    }

    if (mediaIds.size === 0) {
      throw new Error(`No media found in tracks for timeline ${timelineId}`);
    }

    this.logger.debug(`Need to resolve ${mediaIds.size} unique media files`);

    const clipMediaMap: Record<string, { media: Media; filePath: string }> = {};

    for (const mediaId of mediaIds) {
      try {
        // Get media record
        const media = await this.pocketbaseService.getMedia(mediaId);
        if (!media) {
          throw new Error(`Media ${mediaId} not found`);
        }

        // Get upload to have workspace context
        const upload = await this.pocketbaseService.getUploadByMedia(media.id);
        if (!upload) {
          throw new Error(`No upload found for media ${media.id}`);
        }

        // Get the source file from the Upload record (ORIGINAL file)
        if (!upload.externalPath) {
          throw new Error(
            `Upload ${upload.id} has no externalPath (original file missing)`
          );
        }

        // Try to resolve the file path using the upload's backend and path
        const storageBackend = Array.isArray(upload.storageBackend)
          ? upload.storageBackend[0]
          : upload.storageBackend;

        let filePath = await this.storageService.resolveFilePath({
          storagePath: upload.externalPath,
          storageBackend: storageBackend as StorageBackendType,
          recordId: media.id,
        });

        // If file doesn't exist at the expected path, try alternative paths
        if (!fs.existsSync(filePath)) {
          this.logger.warn(
            `Original file not found at expected path: ${filePath}, trying alternatives...`
          );

          const alternativePath = await this.tryAlternativePaths(
            upload.externalPath,
            upload.WorkspaceRef,
            upload.id,
            upload.name
          );

          if (alternativePath) {
            this.logger.log(
              `Found file at alternative path: ${alternativePath}`
            );
            filePath = alternativePath;
          } else {
            this.logger.error(
              `Original file does not exist at any expected path:\n` +
                `  externalPath: ${upload.externalPath}\n` +
                `  Resolved path: ${filePath}\n` +
                `  storageBackend: ${upload.storageBackend}\n` +
                `  media.id: ${media.id}\n` +
                `  upload.id: ${upload.id}\n` +
                `  upload.WorkspaceRef: ${upload.WorkspaceRef}`
            );
            throw new Error(
              `Original source file does not exist: ${filePath}. ` +
                `The externalPath '${upload.externalPath}' may be incorrect in the database.`
            );
          }
        }

        // Use mediaId as the key for easier lookup in the compose executor
        clipMediaMap[mediaId] = { media, filePath };
        this.logger.debug(`Resolved original media ${mediaId}: ${filePath}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to resolve original media ${mediaId}: ${errorMessage}`
        );
        throw error;
      }
    }

    this.logger.log(
      `Successfully resolved ${Object.keys(clipMediaMap).length} media files`
    );
    return { clipMediaMap };
  }

  /**
   * Try alternative path patterns when the s3Key-based path doesn't exist.
   * This handles legacy database records with incorrect paths.
   */
  private async tryAlternativePaths(
    s3Key: string,
    workspaceId: string,
    uploadId: string,
    fileName: string
  ): Promise<string | null> {
    const basePath = this.storageService.getBasePath();

    // Extract just the filename from the s3Key
    const s3FileName = path.basename(s3Key);

    // Alternative path patterns to try (only for ORIGINAL files)
    const alternatives = [
      // Pattern 1: uploads/<workspaceId>/<uploadId>/<fileName>
      path.join(basePath, 'uploads', workspaceId, uploadId, s3FileName),
      // Pattern 2: uploads/<workspaceId>/<uploadId>/<original fileName from record>
      path.join(basePath, 'uploads', workspaceId, uploadId, fileName),
      // Pattern 3: Look for any original file in the upload folder
      path.join(basePath, 'uploads', workspaceId, uploadId),
    ];

    for (const altPath of alternatives) {
      // If it's a directory, look for original files inside
      if (fs.existsSync(altPath) && fs.statSync(altPath).isDirectory()) {
        const files = fs.readdirSync(altPath);

        // Look for original file (avoid proxies or other generated files)
        const originalFile = files.find(
          (f) =>
            !f.includes('_') &&
            (f.endsWith('.mp4') ||
              f.endsWith('.mov') ||
              f.endsWith('.avi') ||
              f.endsWith('.mkv'))
        );
        if (originalFile) {
          return path.join(altPath, originalFile);
        }
      } else if (fs.existsSync(altPath)) {
        return altPath;
      }
    }

    return null;
  }
}
