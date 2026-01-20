import { Injectable, Logger } from '@nestjs/common';
import { ProcessingProvider, RawLabelCacheFile } from '@project/shared';
import { StorageService } from '../../shared/services/storage.service';
import { getLabelCachePath } from '../utils/cache-keys';

/**
 * Service for managing cached label data in StorageBackend
 *
 * Handles reading and writing raw provider responses to avoid redundant API calls
 * when processor versions match.
 */
@Injectable()
export class LabelCacheService {
  private readonly logger = new Logger(LabelCacheService.name);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Retrieve cached labels from storage
   *
   * @param workspaceId - Workspace record ID
   * @param mediaId - Media record ID
   * @param version - Data version number
   * @param provider - Processing provider
   * @param processorVersion - Processor version string (e.g., "label-detection:1.0.0")
   * @returns Cached label data if exists, null otherwise
   */
  async getCachedLabels(
    workspaceId: string,
    mediaId: string,
    version: number,
    provider: ProcessingProvider,
    processorVersion: string
  ): Promise<RawLabelCacheFile | null> {
    const cachePath = getLabelCachePath(
      workspaceId,
      mediaId,
      version,
      provider,
      processorVersion
    );

    try {
      // Check if cache exists
      const exists = await this.storageService.exists(cachePath);
      if (!exists) {
        this.logger.debug(`Cache miss: ${cachePath}`);
        return null;
      }

      // Download and parse cache file
      const stream = await this.storageService.download(cachePath);
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Combine chunks and parse JSON
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const jsonString = new TextDecoder().decode(combined);
      const cacheData = JSON.parse(jsonString) as RawLabelCacheFile;

      this.logger.log(
        `Cache hit: ${cachePath} (processor: ${cacheData.metadata.processor})`
      );
      return cacheData;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to read cache ${cachePath}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Store label data to cache
   *
   * @param workspaceId - Workspace record ID
   * @param mediaId - Media record ID
   * @param version - Data version number
   * @param provider - Processing provider
   * @param data - Provider response data to cache
   * @param processor - Processor version string (e.g., "video-intelligence:1.2.0")
   * @param features - Optional list of features used (e.g., ['LABEL_DETECTION'])
   */
  async storeLabelCache(
    workspaceId: string,
    mediaId: string,
    version: number,
    provider: ProcessingProvider,
    data: unknown,
    processor: string,
    features: string[] = []
  ): Promise<void> {
    const cachePath = getLabelCachePath(
      workspaceId,
      mediaId,
      version,
      provider,
      processor
    );

    try {
      const cacheFile: RawLabelCacheFile = {
        metadata: {
          mediaId,
          version,
          provider,
          processor,
          createdAt: new Date().toISOString(),
          features,
        },
        response: data,
      };

      const jsonString = JSON.stringify(cacheFile, null, 2);
      const buffer = Buffer.from(jsonString, 'utf-8');

      await this.storageService.upload(cachePath, buffer);

      this.logger.log(
        `Stored cache: ${cachePath} (processor: ${processor}, size: ${buffer.length} bytes)`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to store cache ${cachePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Check if cached data is valid for the current processor version
   *
   * @param cached - Cached label data
   * @param currentProcessor - Current processor version string
   * @returns true if cache is valid (processor versions match)
   */
  isCacheValid(cached: RawLabelCacheFile, currentProcessor: string): boolean {
    const isValid = cached.metadata.processor === currentProcessor;

    if (!isValid) {
      this.logger.debug(
        `Cache invalid: processor mismatch (cached: ${cached.metadata.processor}, current: ${currentProcessor})`
      );
    }

    return isValid;
  }
}
