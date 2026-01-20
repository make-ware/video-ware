'use client';

/**
 * Upload Queue Context
 *
 * Manages a client-side queue of file uploads with:
 * - Multiple concurrent uploads with configurable limit
 * - Individual progress tracking for each upload
 * - Pause/resume/cancel controls for individual uploads
 * - Batch operations (pause all, resume all, cancel all)
 * - Automatic queue progression
 */

import React, {
  createContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import type {
  UploadItem,
  UploadQueueState,
  UploadManagerActions,
} from '@/types/upload-manager';
import { UploadItemStatus } from '@/types/upload-manager';
import { StorageBackendType } from '@project/shared';
import {
  calculateProgress,
  calculateTotalProgress,
} from '@/utils/upload-progress';
import {
  saveQueueState,
  restoreQueueState,
  handleStaleUploads,
} from '@/utils/upload-persistence';
import { ChunkedUploadService } from '@/services/chunked-upload';
import type { ChunkProgress } from '@/services/chunked-upload';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import pb from '@/lib/pocketbase-client';
import { useMemo } from 'react';

// Action types for the reducer
type QueueAction =
  | { type: 'ADD_FILES'; payload: { files: File[]; workspaceId: string } }
  | {
      type: 'UPDATE_ITEM';
      payload: { id: string; updates: Partial<UploadItem> };
    }
  | {
      type: 'UPDATE_PROGRESS';
      payload: { id: string; loaded: number; total: number; startTime: number };
    }
  | { type: 'PAUSE_UPLOAD'; payload: { id: string } }
  | { type: 'RESUME_UPLOAD'; payload: { id: string } }
  | { type: 'CANCEL_UPLOAD'; payload: { id: string } }
  | { type: 'RETRY_UPLOAD'; payload: { id: string } }
  | { type: 'PAUSE_ALL' }
  | { type: 'RESUME_ALL' }
  | { type: 'CANCEL_ALL' }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'SET_MAX_CONCURRENT'; payload: { count: number } }
  | { type: 'START_UPLOAD'; payload: { id: string } }
  | {
      type: 'COMPLETE_UPLOAD';
      payload: { id: string; uploadId: string; externalPath: string };
    }
  | { type: 'FAIL_UPLOAD'; payload: { id: string; error: string } };

// Initial state
const initialState: UploadQueueState = {
  items: [],
  activeCount: 0,
  maxConcurrent: 1, // Limit to 1 concurrent upload for stability
  totalProgress: {
    completed: 0,
    total: 0,
    percentage: 0,
  },
  isPaused: false,
};

// Reducer function
function queueReducer(
  state: UploadQueueState,
  action: QueueAction
): UploadQueueState {
  switch (action.type) {
    case 'ADD_FILES': {
      const { files, workspaceId } = action.payload;

      // Create upload items for each file
      const newItems: UploadItem[] = files.map((file) => ({
        id: uuidv4(),
        file,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        status: 'queued' as UploadItemStatus,
        progress: {
          loaded: 0,
          total: file.size,
          percentage: 0,
          speed: 0,
          estimatedTimeRemaining: 0,
        },
        retryCount: 0,
        createdAt: new Date(),
        workspaceId,
        storageBackend: StorageBackendType.LOCAL, // Default, can be configured
      }));

      const items = [...state.items, ...newItems];
      const totalProgress = calculateTotalProgress(items);

      return {
        ...state,
        items,
        totalProgress,
      };
    }

    case 'UPDATE_ITEM': {
      const { id, updates } = action.payload;
      const items = state.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      );

      // Recalculate active count
      const activeCount = items.filter(
        (item) => item.status === 'uploading'
      ).length;

      const totalProgress = calculateTotalProgress(items);

      return {
        ...state,
        items,
        activeCount,
        totalProgress,
      };
    }

    case 'UPDATE_PROGRESS': {
      const { id, loaded, total, startTime } = action.payload;
      const progress = calculateProgress(loaded, total, startTime);

      const items = state.items.map((item) =>
        item.id === id ? { ...item, progress } : item
      );

      const totalProgress = calculateTotalProgress(items);

      return {
        ...state,
        items,
        totalProgress,
      };
    }

    case 'START_UPLOAD': {
      const { id } = action.payload;
      const items = state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'uploading' as UploadItemStatus,
              startedAt: new Date(),
            }
          : item
      );

      const activeCount = items.filter(
        (item) => item.status === 'uploading'
      ).length;

      return {
        ...state,
        items,
        activeCount,
      };
    }

    case 'COMPLETE_UPLOAD': {
      const { id, uploadId, externalPath } = action.payload;
      const items = state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'completed' as UploadItemStatus,
              uploadId,
              externalPath,
              completedAt: new Date(),
              progress: {
                ...item.progress,
                loaded: item.fileSize,
                percentage: 100,
              },
            }
          : item
      );

      const activeCount = items.filter(
        (item) => item.status === 'uploading'
      ).length;

      const totalProgress = calculateTotalProgress(items);

      return {
        ...state,
        items,
        activeCount,
        totalProgress,
      };
    }

    case 'FAIL_UPLOAD': {
      const { id, error } = action.payload;
      const items = state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'failed' as UploadItemStatus,
              error,
              retryCount: item.retryCount + 1,
            }
          : item
      );

      const activeCount = items.filter(
        (item) => item.status === 'uploading'
      ).length;

      return {
        ...state,
        items,
        activeCount,
      };
    }

    case 'PAUSE_UPLOAD': {
      const { id } = action.payload;
      const items = state.items.map((item) =>
        item.id === id && item.status === 'uploading'
          ? { ...item, status: 'paused' as UploadItemStatus }
          : item
      );

      const activeCount = items.filter(
        (item) => item.status === 'uploading'
      ).length;

      return {
        ...state,
        items,
        activeCount,
      };
    }

    case 'RESUME_UPLOAD': {
      const { id } = action.payload;
      const items = state.items.map((item) =>
        item.id === id && item.status === 'paused'
          ? { ...item, status: 'queued' as UploadItemStatus }
          : item
      );

      return {
        ...state,
        items,
      };
    }

    case 'CANCEL_UPLOAD': {
      const { id } = action.payload;
      const items = state.items.map((item) =>
        item.id === id
          ? { ...item, status: 'cancelled' as UploadItemStatus }
          : item
      );

      const activeCount = items.filter(
        (item) => item.status === 'uploading'
      ).length;

      return {
        ...state,
        items,
        activeCount,
      };
    }

    case 'RETRY_UPLOAD': {
      const { id } = action.payload;
      const items = state.items.map((item) =>
        item.id === id && item.status === 'failed'
          ? {
              ...item,
              status: 'queued' as UploadItemStatus,
              error: undefined,
              progress: {
                loaded: 0,
                total: item.fileSize,
                percentage: 0,
                speed: 0,
                estimatedTimeRemaining: 0,
              },
            }
          : item
      );

      return {
        ...state,
        items,
      };
    }

    case 'PAUSE_ALL': {
      const items = state.items.map((item) =>
        item.status === 'uploading' || item.status === 'queued'
          ? { ...item, status: 'paused' as UploadItemStatus }
          : item
      );

      return {
        ...state,
        items,
        activeCount: 0,
        isPaused: true,
      };
    }

    case 'RESUME_ALL': {
      const items = state.items.map((item) =>
        item.status === 'paused'
          ? { ...item, status: 'queued' as UploadItemStatus }
          : item
      );

      return {
        ...state,
        items,
        isPaused: false,
      };
    }

    case 'CANCEL_ALL': {
      const items = state.items.map((item) =>
        item.status === 'uploading' ||
        item.status === 'queued' ||
        item.status === 'paused'
          ? { ...item, status: 'cancelled' as UploadItemStatus }
          : item
      );

      return {
        ...state,
        items,
        activeCount: 0,
      };
    }

    case 'CLEAR_COMPLETED': {
      const items = state.items.filter(
        (item) => item.status !== 'completed' && item.status !== 'cancelled'
      );

      const totalProgress = calculateTotalProgress(items);

      return {
        ...state,
        items,
        totalProgress,
      };
    }

    case 'SET_MAX_CONCURRENT': {
      const { count } = action.payload;
      return {
        ...state,
        maxConcurrent: Math.max(1, count), // Ensure at least 1
      };
    }

    default:
      return state;
  }
}

// Context type
interface UploadQueueContextType {
  state: UploadQueueState;
  actions: UploadManagerActions;
  chunkProgress: Map<string, ChunkProgress>; // Track chunk progress per upload
}

// Create context
const UploadQueueContext = createContext<UploadQueueContextType | undefined>(
  undefined
);

// Provider props
interface UploadQueueProviderProps {
  children: React.ReactNode;
  maxConcurrent?: number;
}

// Provider component
export function UploadQueueProvider({
  children,
  maxConcurrent = 1,
}: UploadQueueProviderProps) {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();

  // Create chunked upload service instance
  const uploadService = useMemo(() => new ChunkedUploadService(pb), []);

  // Track chunk progress for each upload
  const [chunkProgress, setChunkProgress] = useState<
    Map<string, ChunkProgress>
  >(new Map());

  // Only restore state on client-side (after mount)
  const [restoredState, setRestoredState] =
    useState<Partial<UploadQueueState> | null>(null);
  const isMountedRef = useRef(false);

  // Restore state only after component mounts (client-side only)
  useEffect(() => {
    isMountedRef.current = true;
    const restored = restoreQueueState();
    setRestoredState(restored);
  }, []);

  const [state, dispatch] = useReducer(queueReducer, {
    ...initialState,
    maxConcurrent,
    // Merge restored state if available (only after mount)
    ...(isMountedRef.current && restoredState ? restoredState : {}),
  });

  // Track upload start times for progress calculation
  const uploadStartTimes = useRef<Map<string, number>>(new Map());

  // Track active upload promises to handle cancellation
  const activeUploadsRef = useRef<Map<string, { abort: () => void }>>(
    new Map()
  );

  // Handle stale uploads on mount
  useEffect(() => {
    if (restoredState && restoredState.items) {
      const handledItems = handleStaleUploads(restoredState.items);

      // Update items if any were marked as stale
      if (handledItems.some((item, i) => item !== restoredState.items![i])) {
        handledItems.forEach((item) => {
          if (item.status === UploadItemStatus.FAILED && item.error) {
            dispatch({
              type: 'UPDATE_ITEM',
              payload: {
                id: item.id,
                updates: { status: UploadItemStatus.FAILED, error: item.error },
              },
            });
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    saveQueueState(state);
  }, [state]);

  // Actions
  const actions: UploadManagerActions = {
    addFiles: useCallback((files: File[], workspaceId: string) => {
      dispatch({ type: 'ADD_FILES', payload: { files, workspaceId } });
    }, []),

    pauseUpload: useCallback((id: string) => {
      dispatch({ type: 'PAUSE_UPLOAD', payload: { id } });
    }, []),

    resumeUpload: useCallback((id: string) => {
      dispatch({ type: 'RESUME_UPLOAD', payload: { id } });
    }, []),

    cancelUpload: useCallback((id: string) => {
      // Abort active upload if any
      const activeUpload = activeUploadsRef.current.get(id);
      if (activeUpload) {
        activeUpload.abort();
        activeUploadsRef.current.delete(id);
      }

      dispatch({ type: 'CANCEL_UPLOAD', payload: { id } });
      uploadStartTimes.current.delete(id);
    }, []),

    retryUpload: useCallback((id: string) => {
      dispatch({ type: 'RETRY_UPLOAD', payload: { id } });
    }, []),

    pauseAll: useCallback(() => {
      dispatch({ type: 'PAUSE_ALL' });
    }, []),

    resumeAll: useCallback(() => {
      dispatch({ type: 'RESUME_ALL' });
    }, []),

    cancelAll: useCallback(() => {
      // Abort all active uploads
      activeUploadsRef.current.forEach((upload) => {
        upload.abort();
      });
      activeUploadsRef.current.clear();

      dispatch({ type: 'CANCEL_ALL' });
      uploadStartTimes.current.clear();
    }, []),

    clearCompleted: useCallback(() => {
      dispatch({ type: 'CLEAR_COMPLETED' });
    }, []),

    setMaxConcurrent: useCallback((count: number) => {
      dispatch({ type: 'SET_MAX_CONCURRENT', payload: { count } });
    }, []),
  };

  // Queue processor - automatically start uploads when slots are available
  useEffect(() => {
    // Don't process if paused
    if (state.isPaused) return;

    // Need workspace and user to upload
    if (!currentWorkspace || !user) return;

    // Check if we can start more uploads
    const { items, activeCount, maxConcurrent } = state;

    if (activeCount >= maxConcurrent) return;

    // Find queued items that have a file (can't restore files from localStorage)
    const queuedItems = items.filter(
      (item) => item.status === 'queued' && item.file
    );

    if (queuedItems.length === 0) return;

    // Start uploads up to the concurrent limit
    const slotsAvailable = maxConcurrent - activeCount;
    const itemsToStart = queuedItems.slice(0, slotsAvailable);

    itemsToStart.forEach((item) => {
      // Skip if already uploading
      if (activeUploadsRef.current.has(item.id)) return;

      // Record start time
      const startTime = Date.now();
      uploadStartTimes.current.set(item.id, startTime);

      // Dispatch start action
      dispatch({ type: 'START_UPLOAD', payload: { id: item.id } });

      // Create upload record first
      uploadService
        .createUploadRecord(currentWorkspace.id, item.file!, user.id)
        .then((uploadRecord) => {
          // Start chunked upload
          return uploadService.uploadFile(
            uploadRecord.id,
            currentWorkspace.id,
            user.id,
            item.file!,
            (chunkProgressData) => {
              // Update chunk progress
              setChunkProgress((prev) => {
                const newMap = new Map(prev);
                newMap.set(item.id, chunkProgressData);
                return newMap;
              });

              // Update overall progress
              dispatch({
                type: 'UPDATE_PROGRESS',
                payload: {
                  id: item.id,
                  loaded: chunkProgressData.bytesUploaded,
                  total: chunkProgressData.totalBytes,
                  startTime,
                },
              });
            }
          );
        })
        .then((upload) => {
          // Upload completed successfully
          dispatch({
            type: 'COMPLETE_UPLOAD',
            payload: {
              id: item.id,
              uploadId: upload.id,
              externalPath: upload.externalPath || '',
            },
          });
          activeUploadsRef.current.delete(item.id);
          uploadStartTimes.current.delete(item.id);
          setChunkProgress((prev) => {
            const newMap = new Map(prev);
            newMap.delete(item.id);
            return newMap;
          });
        })
        .catch((error) => {
          // Upload failed
          const errorMessage =
            error instanceof Error ? error.message : 'Upload failed';

          dispatch({
            type: 'FAIL_UPLOAD',
            payload: {
              id: item.id,
              error: errorMessage,
            },
          });
          activeUploadsRef.current.delete(item.id);
          uploadStartTimes.current.delete(item.id);
          setChunkProgress((prev) => {
            const newMap = new Map(prev);
            newMap.delete(item.id);
            return newMap;
          });
        });

      // Store abort function for cancellation
      activeUploadsRef.current.set(item.id, {
        abort: () => {
          uploadService.cancelUpload(item.id);
        },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.items,
    state.activeCount,
    state.maxConcurrent,
    state.isPaused,
    currentWorkspace,
    user,
    uploadService,
  ]);

  const value: UploadQueueContextType = {
    state,
    actions,
    chunkProgress,
  };

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

// Export context for use in hooks
export { UploadQueueContext };
