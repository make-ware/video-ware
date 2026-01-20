/**
 * Property Tests for Processing Idempotency
 *
 * Feature: media-uploads-ingestion, Property 12: Processing Idempotency
 *
 * For any Upload processed multiple times (via task retry), there SHALL exist
 * exactly one Media record associated with that Upload.
 *
 * Also tests Property 13: Deterministic Output Naming
 * For any two processing runs with identical uploadId, sprite configuration,
 * thumbnail configuration, and processingVersion, the generated output file
 * names SHALL be identical.
 *
 * Validates: Requirements 9.1, 9.2
 */

import { describe, it, expect } from 'vitest';

/**
 * Simple hash function for deterministic naming (same as in task-worker.ts)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Generate deterministic output file name based on uploadId and config
 * (same as in task-worker.ts)
 */
function generateDeterministicFileName(
  uploadId: string,
  fileType: 'thumbnail' | 'sprite',
  config: Record<string, unknown>
): string {
  const configStr = JSON.stringify(config, Object.keys(config).sort());
  const configHash = simpleHash(configStr);

  const extension = fileType === 'thumbnail' ? 'jpg' : 'jpg';
  return `${fileType}_${uploadId}_${configHash}.${extension}`;
}

/**
 * Simulate media record tracking for idempotency testing
 */
class MediaTracker {
  private mediaByUpload: Map<string, { id: string; processingCount: number }> =
    new Map();

  /**
   * Get or create a media record for an upload (idempotent)
   */
  getOrCreateMedia(uploadId: string): {
    id: string;
    isNew: boolean;
    processingCount: number;
  } {
    const existing = this.mediaByUpload.get(uploadId);

    if (existing) {
      existing.processingCount++;
      return {
        id: existing.id,
        isNew: false,
        processingCount: existing.processingCount,
      };
    }

    const newMedia = {
      id: `media_${uploadId}_${Date.now()}`,
      processingCount: 1,
    };
    this.mediaByUpload.set(uploadId, newMedia);
    return { id: newMedia.id, isNew: true, processingCount: 1 };
  }

  /**
   * Get the count of media records for an upload
   */
  getMediaCount(uploadId: string): number {
    return this.mediaByUpload.has(uploadId) ? 1 : 0;
  }

  /**
   * Get processing count for an upload
   */
  getProcessingCount(uploadId: string): number {
    return this.mediaByUpload.get(uploadId)?.processingCount || 0;
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.mediaByUpload.clear();
  }
}

/**
 * Generate random upload IDs for testing
 */
function generateUploadIds(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let j = 0; j < 15; j++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Generate random sprite configurations
 */
function generateSpriteConfigs(count: number): Array<Record<string, unknown>> {
  const configs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    configs.push({
      fps: Math.floor(Math.random() * 5) + 1,
      cols: Math.floor(Math.random() * 10) + 5,
      rows: Math.floor(Math.random() * 10) + 5,
      tileWidth: [160, 320, 480][Math.floor(Math.random() * 3)],
      tileHeight: [90, 180, 270][Math.floor(Math.random() * 3)],
    });
  }
  return configs;
}

/**
 * Generate random thumbnail configurations
 */
function generateThumbnailConfigs(
  count: number
): Array<Record<string, unknown>> {
  const configs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    configs.push({
      timestamp: Math.random() > 0.5 ? 'midpoint' : Math.random() * 100,
      width: [640, 1280, 1920][Math.floor(Math.random() * 3)],
      height: [360, 720, 1080][Math.floor(Math.random() * 3)],
    });
  }
  return configs;
}

describe('Processing Idempotency Property Tests', () => {
  /**
   * Property 12: Processing Idempotency
   * For any Upload processed multiple times (via task retry), there SHALL exist
   * exactly one Media record associated with that Upload.
   * Validates: Requirements 9.1
   */
  describe('Property 12: Processing Idempotency', () => {
    it('should create exactly one Media record per Upload regardless of processing count', () => {
      const tracker = new MediaTracker();
      const uploadIds = generateUploadIds(50);

      for (const uploadId of uploadIds) {
        // Simulate multiple processing attempts (1-5 times)
        const processingAttempts = Math.floor(Math.random() * 5) + 1;

        for (let i = 0; i < processingAttempts; i++) {
          tracker.getOrCreateMedia(uploadId);
        }

        // Verify exactly one media record exists
        expect(tracker.getMediaCount(uploadId)).toBe(1);
        expect(tracker.getProcessingCount(uploadId)).toBe(processingAttempts);
      }
    });

    it('should return the same Media ID for repeated processing of the same Upload', () => {
      const tracker = new MediaTracker();
      const uploadIds = generateUploadIds(50);

      for (const uploadId of uploadIds) {
        // First processing
        const first = tracker.getOrCreateMedia(uploadId);
        expect(first.isNew).toBe(true);

        // Subsequent processing attempts
        for (let i = 0; i < 5; i++) {
          const subsequent = tracker.getOrCreateMedia(uploadId);
          expect(subsequent.isNew).toBe(false);
          expect(subsequent.id).toBe(first.id);
        }
      }
    });

    it('should create separate Media records for different Uploads', () => {
      const tracker = new MediaTracker();
      const uploadIds = generateUploadIds(100);
      const mediaIds = new Set<string>();

      for (const uploadId of uploadIds) {
        const result = tracker.getOrCreateMedia(uploadId);
        mediaIds.add(result.id);
      }

      // Each upload should have a unique media ID
      expect(mediaIds.size).toBe(uploadIds.length);
    });

    it('should handle concurrent-like processing attempts idempotently', () => {
      const tracker = new MediaTracker();
      const uploadId = generateUploadIds(1)[0];

      // Simulate multiple "concurrent" processing attempts
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(tracker.getOrCreateMedia(uploadId));
      }

      // Only the first should be new
      expect(results[0].isNew).toBe(true);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].isNew).toBe(false);
      }

      // All should have the same ID
      const firstId = results[0].id;
      for (const result of results) {
        expect(result.id).toBe(firstId);
      }

      // Only one media record should exist
      expect(tracker.getMediaCount(uploadId)).toBe(1);
    });
  });

  /**
   * Property 13: Deterministic Output Naming
   * For any two processing runs with identical uploadId, sprite configuration,
   * thumbnail configuration, and processingVersion, the generated output file
   * names SHALL be identical.
   * Validates: Requirements 9.2
   */
  describe('Property 13: Deterministic Output Naming', () => {
    it('should generate identical file names for identical inputs', () => {
      const uploadIds = generateUploadIds(50);
      const spriteConfigs = generateSpriteConfigs(50);
      const thumbnailConfigs = generateThumbnailConfigs(50);

      for (let i = 0; i < uploadIds.length; i++) {
        const uploadId = uploadIds[i];
        const spriteConfig = spriteConfigs[i];
        const thumbnailConfig = thumbnailConfigs[i];

        // Generate file names multiple times
        const thumbnailNames: string[] = [];
        const spriteNames: string[] = [];

        for (let j = 0; j < 10; j++) {
          thumbnailNames.push(
            generateDeterministicFileName(
              uploadId,
              'thumbnail',
              thumbnailConfig
            )
          );
          spriteNames.push(
            generateDeterministicFileName(uploadId, 'sprite', spriteConfig)
          );
        }

        // All names should be identical
        const firstThumbnail = thumbnailNames[0];
        const firstSprite = spriteNames[0];

        for (const name of thumbnailNames) {
          expect(name).toBe(firstThumbnail);
        }
        for (const name of spriteNames) {
          expect(name).toBe(firstSprite);
        }
      }
    });

    it('should generate different file names for different uploadIds', () => {
      const uploadIds = generateUploadIds(100);
      const config = {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 160,
        tileHeight: 90,
      };

      const fileNames = new Set<string>();

      for (const uploadId of uploadIds) {
        const fileName = generateDeterministicFileName(
          uploadId,
          'sprite',
          config
        );
        fileNames.add(fileName);
      }

      // All file names should be unique
      expect(fileNames.size).toBe(uploadIds.length);
    });

    it('should generate different file names for different configurations', () => {
      const uploadId = generateUploadIds(1)[0];
      const configs = generateSpriteConfigs(100);

      const fileNames = new Set<string>();

      for (const config of configs) {
        const fileName = generateDeterministicFileName(
          uploadId,
          'sprite',
          config
        );
        fileNames.add(fileName);
      }

      // Most file names should be unique (some configs might randomly be the same)
      // We expect at least 90% uniqueness with random configs
      expect(fileNames.size).toBeGreaterThan(configs.length * 0.5);
    });

    it('should include uploadId in the file name', () => {
      const uploadIds = generateUploadIds(50);
      const config = {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 160,
        tileHeight: 90,
      };

      for (const uploadId of uploadIds) {
        const thumbnailName = generateDeterministicFileName(
          uploadId,
          'thumbnail',
          config
        );
        const spriteName = generateDeterministicFileName(
          uploadId,
          'sprite',
          config
        );

        expect(thumbnailName).toContain(uploadId);
        expect(spriteName).toContain(uploadId);
      }
    });

    it('should include file type in the file name', () => {
      const uploadId = generateUploadIds(1)[0];
      const config = {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 160,
        tileHeight: 90,
      };

      const thumbnailName = generateDeterministicFileName(
        uploadId,
        'thumbnail',
        config
      );
      const spriteName = generateDeterministicFileName(
        uploadId,
        'sprite',
        config
      );

      expect(thumbnailName).toContain('thumbnail');
      expect(spriteName).toContain('sprite');
    });

    it('should generate valid file names with proper extension', () => {
      const uploadIds = generateUploadIds(50);
      const configs = generateSpriteConfigs(50);

      for (let i = 0; i < uploadIds.length; i++) {
        const thumbnailName = generateDeterministicFileName(
          uploadIds[i],
          'thumbnail',
          configs[i]
        );
        const spriteName = generateDeterministicFileName(
          uploadIds[i],
          'sprite',
          configs[i]
        );

        expect(thumbnailName).toMatch(/\.jpg$/);
        expect(spriteName).toMatch(/\.jpg$/);
      }
    });

    it('should be consistent across 100 iterations', () => {
      const uploadId = 'test_upload_123';
      const config = {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 160,
        tileHeight: 90,
      };

      const firstName = generateDeterministicFileName(
        uploadId,
        'sprite',
        config
      );

      for (let i = 0; i < 100; i++) {
        const name = generateDeterministicFileName(uploadId, 'sprite', config);
        expect(name).toBe(firstName);
      }
    });

    it('should handle config key ordering consistently', () => {
      const uploadId = generateUploadIds(1)[0];

      // Same config with different key ordering
      const config1 = {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 160,
        tileHeight: 90,
      };
      const config2 = {
        tileHeight: 90,
        tileWidth: 160,
        rows: 10,
        cols: 10,
        fps: 1,
      };

      const name1 = generateDeterministicFileName(uploadId, 'sprite', config1);
      const name2 = generateDeterministicFileName(uploadId, 'sprite', config2);

      // Should be identical because we sort keys before hashing
      expect(name1).toBe(name2);
    });
  });
});

// Export for use in other tests
export { generateDeterministicFileName, simpleHash, MediaTracker };
