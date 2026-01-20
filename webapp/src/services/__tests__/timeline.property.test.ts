/**
 * Property Tests for TimelineService
 *
 * Feature: clips-and-timelines
 *
 * Property 5: Timeline Creation Defaults
 * For any newly created Timeline, the record SHALL have the specified name, WorkspaceRef,
 * `version = 1`, and `duration = 0`.
 * Validates: Requirements 3.1
 *
 * Property 7: Timeline Clip Ordering Invariant
 * For any timeline with N clips after any add, remove, or reorder operation, the clips
 * SHALL have order values forming a contiguous sequence from 0 to N-1 with no duplicates.
 * Validates: Requirements 4.1, 4.2, 4.3
 *
 * Property 9: Timeline Duration Calculation
 * For any Timeline, the computed duration SHALL equal the sum of `(end - start)` for
 * all TimelineClips.
 * Validates: Requirements 5.4, 6.1, 6.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineService } from '../timeline';
import type { TypedPocketBase } from '@project/shared/types';
import {
  type Timeline,
  type TimelineClip,
  type Media,
  MediaType,
} from '@project/shared';
import { createGenericMockCollection } from '@/test/__tests__/fixtures/pocketbase';

/**
 * Create a mock PocketBase client for testing
 */
function createMockPocketBase(): TypedPocketBase {
  let timelineIdCounter = 0;
  let clipIdCounter = 0;
  let taskIdCounter = 0;

  // Create generic mock collections
  const timelinesCollection = createGenericMockCollection<Timeline>(
    'Timelines',
    () => `timeline-${++timelineIdCounter}`
  );

  const timelineClipsCollection = createGenericMockCollection<TimelineClip>(
    'TimelineClips',
    () => `clip-${++clipIdCounter}`
  );

  const mediaCollection = createGenericMockCollection<Media>(
    'Media',
    () => `media-${Math.random().toString(36).substring(7)}`
  );

  const mediaClipsCollection = createGenericMockCollection<any>(
    'MediaClips',
    () => `mediaclip-${Math.random().toString(36).substring(7)}`
  );

  const tasksCollection = createGenericMockCollection<any>(
    'Tasks',
    () => `task-${++taskIdCounter}`
  );

  const pb = {
    collection: (name: string) => {
      if (name === 'Timelines') {
        return timelinesCollection;
      } else if (name === 'TimelineClips') {
        return timelineClipsCollection;
      } else if (name === 'Media') {
        return mediaCollection;
      } else if (name === 'MediaClips') {
        return mediaClipsCollection;
      } else if (name === 'Tasks') {
        return tasksCollection;
      }
      // Return a minimal mock for unknown collections
      return createGenericMockCollection(name);
    },
  } as unknown as TypedPocketBase;

  // Add helper to add mock media
  (pb as any).addMockMedia = (id: string, duration: number) => {
    const media: Media & { expand?: Record<string, unknown> } = {
      id,
      collectionId: 'media',
      collectionName: 'Media',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      WorkspaceRef: 'workspace-1',
      duration,
      mediaType: MediaType.VIDEO,
      UploadRef: 'upload-1',
      version: 1,
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      mediaData: {},
      hasAudio: true,
      isActive: true,
      expand: {},
    };
    mediaCollection._storage.set(id, media);
  };

  return pb;
}

describe('TimelineService Property Tests', () => {
  let service: TimelineService;
  let pb: TypedPocketBase;

  beforeEach(() => {
    pb = createMockPocketBase();
    service = new TimelineService(pb);
  });

  /**
   * Property 5: Timeline Creation Defaults
   * For any newly created Timeline, the record SHALL have the specified name, WorkspaceRef,
   * `version = 1`, and `duration = 0`.
   * Validates: Requirements 3.1
   */
  describe('Property 5: Timeline Creation Defaults', () => {
    it('should create timelines with version=1 and duration=0 for any name/workspace', async () => {
      // Test with 100 random names and workspace IDs
      for (let i = 0; i < 100; i++) {
        const name = `Timeline ${Math.random().toString(36).substring(7)}`;
        const workspaceId = `workspace-${Math.random().toString(36).substring(7)}`;

        const timeline = await service.createTimeline(workspaceId, name);

        expect(timeline.name).toBe(name);
        expect(timeline.WorkspaceRef).toBe(workspaceId);
        expect(timeline.version).toBe(1);
        expect(timeline.duration).toBe(0);
      }
    });

    it('should create timelines with consistent defaults regardless of name length', async () => {
      const testCases = [
        'A',
        'Short',
        'A reasonably long timeline name',
        'A'.repeat(200), // Max length
      ];

      for (const name of testCases) {
        const timeline = await service.createTimeline('workspace-1', name);

        expect(timeline.version).toBe(1);
        expect(timeline.duration).toBe(0);
      }
    });
  });

  /**
   * Property 7: Timeline Clip Ordering Invariant
   * For any timeline with N clips after any add, remove, or reorder operation, the clips
   * SHALL have order values forming a contiguous sequence from 0 to N-1 with no duplicates.
   * Validates: Requirements 4.1, 4.2, 4.3
   */
  describe('Property 7: Timeline Clip Ordering Invariant', () => {
    beforeEach(() => {
      // Add mock media for testing
      for (let i = 0; i < 10; i++) {
        (pb as any).addMockMedia(`media-${i}`, 100);
      }
    });

    it('should maintain contiguous order after adding clips', async () => {
      // Test with 100 different clip counts
      for (let clipCount = 1; clipCount <= 100; clipCount++) {
        const timeline = await service.createTimeline(
          'workspace-1',
          `Timeline ${clipCount}`
        );

        // Add clips
        for (let i = 0; i < clipCount; i++) {
          await service.addClipToTimeline(
            timeline.id,
            `media-${i % 10}`,
            0,
            10
          );
        }

        // Get clips and verify order
        const timelineWithClips = await service.getTimeline(timeline.id);
        expect(timelineWithClips).not.toBeNull();

        const clips = timelineWithClips!.clips;
        expect(clips.length).toBe(clipCount);

        const orders = clips.map((c) => c.order).sort((a, b) => a - b);
        const expectedOrders = Array.from({ length: clipCount }, (_, i) => i);

        expect(orders).toEqual(expectedOrders);
      }
    });

    it('should maintain contiguous order after removing clips', async () => {
      // Test with 50 different scenarios
      for (let test = 0; test < 50; test++) {
        const initialCount = 5 + Math.floor(Math.random() * 10); // 5-14 clips
        const removeCount = 1 + Math.floor(Math.random() * (initialCount - 1)); // Remove 1 to N-1 clips

        const timeline = await service.createTimeline(
          'workspace-1',
          `Timeline ${test}`
        );

        // Add clips
        const clipIds: string[] = [];
        for (let i = 0; i < initialCount; i++) {
          const clip = await service.addClipToTimeline(
            timeline.id,
            `media-${i % 10}`,
            0,
            10
          );
          clipIds.push(clip.id);
        }

        // Remove random clips
        const clipsToRemove = clipIds
          .sort(() => Math.random() - 0.5)
          .slice(0, removeCount);

        for (const clipId of clipsToRemove) {
          await service.removeClipFromTimeline(clipId);
        }

        // Verify remaining clips have contiguous order
        const timelineWithClips = await service.getTimeline(timeline.id);
        const clips = timelineWithClips!.clips;
        const expectedCount = initialCount - removeCount;

        expect(clips.length).toBe(expectedCount);

        const orders = clips.map((c) => c.order).sort((a, b) => a - b);
        const expectedOrders = Array.from(
          { length: expectedCount },
          (_, i) => i
        );

        expect(orders).toEqual(expectedOrders);
      }
    });

    it('should maintain contiguous order after reordering clips', async () => {
      // Test with 50 different reorder scenarios
      for (let test = 0; test < 50; test++) {
        const clipCount = 3 + Math.floor(Math.random() * 7); // 3-9 clips
        const timeline = await service.createTimeline(
          'workspace-1',
          `Timeline ${test}`
        );

        // Add clips
        const clipIds: string[] = [];
        for (let i = 0; i < clipCount; i++) {
          const clip = await service.addClipToTimeline(
            timeline.id,
            `media-${i % 10}`,
            0,
            10
          );
          clipIds.push(clip.id);
        }

        // Shuffle order
        const shuffledIds = [...clipIds].sort(() => Math.random() - 0.5);
        const newOrders = shuffledIds.map((id, index) => ({
          id,
          order: index,
        }));

        await service.reorderClips(timeline.id, newOrders);

        // Verify clips have contiguous order
        const timelineWithClips = await service.getTimeline(timeline.id);
        const clips = timelineWithClips!.clips;

        expect(clips.length).toBe(clipCount);

        const orders = clips.map((c) => c.order).sort((a, b) => a - b);
        const expectedOrders = Array.from({ length: clipCount }, (_, i) => i);

        expect(orders).toEqual(expectedOrders);
      }
    });
  });

  /**
   * Property 9: Timeline Duration Calculation
   * For any Timeline, the computed duration SHALL equal the sum of `(end - start)` for
   * all TimelineClips.
   * Validates: Requirements 5.4, 6.1, 6.3
   */
  describe('Property 9: Timeline Duration Calculation', () => {
    beforeEach(() => {
      // Add mock media for testing
      for (let i = 0; i < 10; i++) {
        (pb as any).addMockMedia(`media-${i}`, 100);
      }
    });

    it('should calculate duration as sum of clip durations', async () => {
      // Test with 100 different clip configurations
      for (let test = 0; test < 100; test++) {
        const clipCount = 1 + Math.floor(Math.random() * 10); // 1-10 clips
        const timeline = await service.createTimeline(
          'workspace-1',
          `Timeline ${test}`
        );

        let expectedDuration = 0;

        // Add clips with random durations
        for (let i = 0; i < clipCount; i++) {
          const start = Math.random() * 50; // 0-50 seconds
          const duration = 0.5 + Math.random() * 10; // 0.5-10.5 seconds
          const end = start + duration;

          await service.addClipToTimeline(
            timeline.id,
            `media-${i % 10}`,
            start,
            end
          );

          expectedDuration += duration;
        }

        // Calculate duration
        const calculatedDuration = await service.calculateDuration(timeline.id);

        // Allow small floating point error
        expect(Math.abs(calculatedDuration - expectedDuration)).toBeLessThan(
          0.0001
        );
      }
    });

    it('should return 0 duration for empty timeline', async () => {
      // Test with 10 empty timelines
      for (let i = 0; i < 10; i++) {
        const timeline = await service.createTimeline(
          'workspace-1',
          `Empty ${i}`
        );
        const duration = await service.calculateDuration(timeline.id);
        expect(duration).toBe(0);
      }
    });

    it('should update duration correctly after adding clips', async () => {
      // Test with 50 different scenarios
      for (let test = 0; test < 50; test++) {
        const timeline = await service.createTimeline(
          'workspace-1',
          `Timeline ${test}`
        );
        let expectedDuration = 0;

        // Add clips one by one and verify duration updates
        const clipCount = 1 + Math.floor(Math.random() * 5); // 1-5 clips
        for (let i = 0; i < clipCount; i++) {
          const start = Math.random() * 50;
          const duration = 0.5 + Math.random() * 10;
          const end = start + duration;

          await service.addClipToTimeline(
            timeline.id,
            `media-${i % 10}`,
            start,
            end
          );

          expectedDuration += duration;

          const calculatedDuration = await service.calculateDuration(
            timeline.id
          );
          expect(Math.abs(calculatedDuration - expectedDuration)).toBeLessThan(
            0.0001
          );
        }
      }
    });

    it('should update duration correctly after removing clips', async () => {
      // Test with 50 different scenarios
      for (let test = 0; test < 50; test++) {
        const timeline = await service.createTimeline(
          'workspace-1',
          `Timeline ${test}`
        );

        // Add clips
        const clipData: Array<{ id: string; duration: number }> = [];
        for (let i = 0; i < 5; i++) {
          const start = Math.random() * 50;
          const duration = 0.5 + Math.random() * 10;
          const end = start + duration;

          const clip = await service.addClipToTimeline(
            timeline.id,
            `media-${i % 10}`,
            start,
            end
          );

          clipData.push({ id: clip.id, duration });
        }

        // Remove a random clip
        const removeIndex = Math.floor(Math.random() * clipData.length);
        const removedClip = clipData[removeIndex];
        await service.removeClipFromTimeline(removedClip.id);

        // Calculate expected duration
        const expectedDuration = clipData
          .filter((_, idx) => idx !== removeIndex)
          .reduce((sum, c) => sum + c.duration, 0);

        const calculatedDuration = await service.calculateDuration(timeline.id);
        expect(Math.abs(calculatedDuration - expectedDuration)).toBeLessThan(
          0.0001
        );
      }
    });
  });
});
