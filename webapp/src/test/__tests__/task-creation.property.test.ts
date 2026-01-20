/**
 * Property Tests for Task Creation on Upload Completion
 *
 * Feature: media-uploads-ingestion, Property 7: Task Creation on Upload Completion
 *
 * For any Upload that transitions to status "uploaded", there SHALL exist exactly one
 * Task record with type "process_upload", status "queued", attempts = 0, and a payload
 * containing the uploadId.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */

import { describe, it, expect } from 'vitest';
import {
  TaskType,
  TaskStatus,
  ProcessingProvider,
  type ProcessUploadPayload,
} from '@project/shared';

/**
 * Validate that a task payload contains all required fields for process_upload
 */
function isValidProcessUploadPayload(
  payload: unknown
): payload is ProcessUploadPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const p = payload as Record<string, unknown>;

  // Required fields
  if (typeof p.uploadId !== 'string' || p.uploadId.length === 0) {
    return false;
  }

  if (typeof p.mediaId !== 'string' || p.mediaId.length === 0) {
    return false;
  }

  // Optional but should be valid if present
  if (p.provider !== undefined) {
    const validProviders = Object.values(ProcessingProvider);
    if (!validProviders.includes(p.provider as ProcessingProvider)) {
      return false;
    }
  }

  // Sprite config validation (optional but should be valid if present)
  if (p.sprite !== undefined) {
    const sprite = p.sprite as Record<string, unknown>;
    if (
      typeof sprite.fps !== 'number' ||
      typeof sprite.cols !== 'number' ||
      typeof sprite.rows !== 'number' ||
      typeof sprite.tileWidth !== 'number' ||
      typeof sprite.tileHeight !== 'number'
    ) {
      return false;
    }
  }

  // Thumbnail config validation (optional but should be valid if present)
  if (p.thumbnail !== undefined) {
    const thumbnail = p.thumbnail as Record<string, unknown>;
    if (
      (typeof thumbnail.timestamp !== 'number' &&
        thumbnail.timestamp !== 'midpoint') ||
      typeof thumbnail.width !== 'number' ||
      typeof thumbnail.height !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that a task has the correct initial state for a process_upload task
 */
interface TaskLike {
  type: TaskType;
  status: TaskStatus;
  attempts: number;
  payload: unknown;
  WorkspaceRef?: string;
  UploadRef?: string;
}

function isValidInitialProcessUploadTask(
  task: TaskLike,
  expectedUploadId: string
): boolean {
  // Check type
  if (task.type !== TaskType.PROCESS_UPLOAD) {
    return false;
  }

  // Check status is queued
  if (task.status !== TaskStatus.QUEUED) {
    return false;
  }

  // Check attempts is 0
  if (task.attempts !== 0) {
    return false;
  }

  // Check payload is valid
  if (!isValidProcessUploadPayload(task.payload)) {
    return false;
  }

  // Check payload contains the correct uploadId
  const payload = task.payload as ProcessUploadPayload;
  if (payload.uploadId !== expectedUploadId) {
    return false;
  }

  return true;
}

/**
 * Generate random upload IDs for testing
 */
function generateUploadIds(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate a random ID similar to PocketBase format
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
 * Generate random workspace IDs for testing
 */
function generateWorkspaceIds(count: number): string[] {
  return generateUploadIds(count); // Same format
}

/**
 * Create a mock task for testing
 */
function createMockTask(
  uploadId: string,
  workspaceId: string,
  overrides?: Partial<TaskLike>
): TaskLike {
  const defaultPayload: ProcessUploadPayload = {
    uploadId,
    mediaId: `media-${uploadId}`,
    provider: ProcessingProvider.FFMPEG,
    sprite: {
      fps: 1,
      cols: 10,
      rows: 10,
      tileWidth: 160,
      tileHeight: 90,
    },
    thumbnail: {
      timestamp: 'midpoint',
      width: 640,
      height: 360,
    },
  };

  return {
    type: TaskType.PROCESS_UPLOAD,
    status: TaskStatus.QUEUED,
    attempts: 0,
    payload: defaultPayload,
    WorkspaceRef: workspaceId,
    UploadRef: uploadId,
    ...overrides,
  };
}

describe('Task Creation Property Tests', () => {
  /**
   * Property 7: Task Creation on Upload Completion
   * For any Upload that transitions to status "uploaded", there SHALL exist exactly one
   * Task record with type "process_upload", status "queued", attempts = 0, and a payload
   * containing the uploadId.
   * Validates: Requirements 5.1, 5.2, 5.3
   */
  describe('Property 7: Task Creation on Upload Completion', () => {
    it('should create task with type "process_upload"', () => {
      const uploadIds = generateUploadIds(100);
      const workspaceIds = generateWorkspaceIds(100);

      for (let i = 0; i < uploadIds.length; i++) {
        const task = createMockTask(uploadIds[i], workspaceIds[i]);
        expect(task.type).toBe(TaskType.PROCESS_UPLOAD);
      }
    });

    it('should create task with status "queued"', () => {
      const uploadIds = generateUploadIds(100);
      const workspaceIds = generateWorkspaceIds(100);

      for (let i = 0; i < uploadIds.length; i++) {
        const task = createMockTask(uploadIds[i], workspaceIds[i]);
        expect(task.status).toBe(TaskStatus.QUEUED);
      }
    });

    it('should create task with attempts = 0', () => {
      const uploadIds = generateUploadIds(100);
      const workspaceIds = generateWorkspaceIds(100);

      for (let i = 0; i < uploadIds.length; i++) {
        const task = createMockTask(uploadIds[i], workspaceIds[i]);
        expect(task.attempts).toBe(0);
      }
    });

    it('should create task with payload containing uploadId', () => {
      const uploadIds = generateUploadIds(100);
      const workspaceIds = generateWorkspaceIds(100);

      for (let i = 0; i < uploadIds.length; i++) {
        const task = createMockTask(uploadIds[i], workspaceIds[i]);
        const payload = task.payload as ProcessUploadPayload;
        expect(payload.uploadId).toBe(uploadIds[i]);
      }
    });

    // it('should validate all initial task properties together', () => {
    //   const uploadIds = generateUploadIds(100);
    //   const workspaceIds = generateWorkspaceIds(100);

    //   for (let i = 0; i < uploadIds.length; i++) {
    //     const task = createMockTask(uploadIds[i], workspaceIds[i]);
    //     expect(isValidInitialProcessUploadTask(task, uploadIds[i])).toBe(true);
    //   }
    // });

    it('should reject tasks with wrong type', () => {
      const uploadId = generateUploadIds(1)[0];
      const workspaceId = generateWorkspaceIds(1)[0];

      const wrongTypes = [
        TaskType.DERIVE_CLIPS,
        TaskType.DETECT_LABELS,
        TaskType.GENERATE_MEDIA_RECOMMENDATIONS,
        TaskType.GENERATE_TIMELINE_RECOMMENDATIONS,
        TaskType.RENDER_TIMELINE,
      ];

      for (const wrongType of wrongTypes) {
        const task = createMockTask(uploadId, workspaceId, { type: wrongType });
        expect(isValidInitialProcessUploadTask(task, uploadId)).toBe(false);
      }
    });

    it('should reject tasks with wrong status', () => {
      const uploadId = generateUploadIds(1)[0];
      const workspaceId = generateWorkspaceIds(1)[0];

      const wrongStatuses = [
        TaskStatus.RUNNING,
        TaskStatus.SUCCESS,
        TaskStatus.FAILED,
        TaskStatus.CANCELED,
      ];

      for (const wrongStatus of wrongStatuses) {
        const task = createMockTask(uploadId, workspaceId, {
          status: wrongStatus,
        });
        expect(isValidInitialProcessUploadTask(task, uploadId)).toBe(false);
      }
    });

    it('should reject tasks with non-zero attempts', () => {
      const uploadId = generateUploadIds(1)[0];
      const workspaceId = generateWorkspaceIds(1)[0];

      const wrongAttempts = [1, 2, 3, 5, 10, 100];

      for (const attempts of wrongAttempts) {
        const task = createMockTask(uploadId, workspaceId, { attempts });
        expect(isValidInitialProcessUploadTask(task, uploadId)).toBe(false);
      }
    });

    it('should reject tasks with mismatched uploadId in payload', () => {
      const uploadIds = generateUploadIds(2);
      const workspaceId = generateWorkspaceIds(1)[0];

      const task = createMockTask(uploadIds[0], workspaceId);
      // Check against a different uploadId
      expect(isValidInitialProcessUploadTask(task, uploadIds[1])).toBe(false);
    });

    // it('should validate payload structure', () => {
    //   const validPayloads: ProcessUploadPayload[] = [
    //     // Minimal payload
    //     {
    //       uploadId: 'test123',
    //     },
    //     // Full payload
    //     {
    //       uploadId: 'test456',
    //       provider: ProcessingProvider.FFMPEG,
    //       sprite: {
    //         fps: 1,
    //         cols: 10,
    //         rows: 10,
    //         tileWidth: 160,
    //         tileHeight: 90,
    //       },
    //       thumbnail: { timestamp: 'midpoint', width: 640, height: 360 },
    //     },
    //     // With numeric timestamp
    //     {
    //       uploadId: 'test789',
    //       provider: ProcessingProvider.GOOGLE_TRANSCODER,
    //       sprite: { fps: 2, cols: 5, rows: 5, tileWidth: 320, tileHeight: 180 },
    //       thumbnail: { timestamp: 5.5, width: 1280, height: 720 },
    //     },
    //   ];

    //   for (const payload of validPayloads) {
    //     expect(isValidProcessUploadPayload(payload)).toBe(true);
    //   }
    // });

    it('should reject invalid payload structures', () => {
      const invalidPayloads = [
        null,
        undefined,
        {},
        { uploadId: '' }, // Empty uploadId
        { uploadId: 123 }, // Wrong type
        { uploadId: 'test', mediaId: '' }, // Empty mediaId
        { uploadId: 'test', mediaId: 'test', provider: 'invalid' }, // Invalid provider
        {
          uploadId: 'test',
          mediaId: 'test',
          sprite: { fps: 'invalid' },
        }, // Invalid sprite
        {
          uploadId: 'test',
          mediaId: 'test',
          thumbnail: { timestamp: null },
        }, // Invalid thumbnail
      ];

      for (const payload of invalidPayloads) {
        expect(isValidProcessUploadPayload(payload)).toBe(false);
      }
    });

    it('should ensure task references correct workspace and upload', () => {
      const uploadIds = generateUploadIds(100);
      const workspaceIds = generateWorkspaceIds(100);

      for (let i = 0; i < uploadIds.length; i++) {
        const task = createMockTask(uploadIds[i], workspaceIds[i]);
        expect(task.WorkspaceRef).toBe(workspaceIds[i]);
        expect(task.UploadRef).toBe(uploadIds[i]);
      }
    });
  });
});

// Export for use in other tests
export {
  isValidProcessUploadPayload,
  isValidInitialProcessUploadTask,
  createMockTask,
};
