'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { Upload } from '@project/shared';
import { UploadService } from '@/services/upload';
import { UploadMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import type { RecordSubscription } from 'pocketbase';
import { useAuth } from '@/hooks/use-auth';
import type { UploadProgress as ClientUploadProgress } from '@/types/upload-manager';

interface UploadProgress {
  uploadId: string;
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}

interface UploadContextType {
  // State
  uploads: Upload[];
  isLoading: boolean;
  error: string | null;
  uploadProgress: Map<string, UploadProgress>;

  // Operations
  uploadFile: (file: File) => Promise<Upload>;
  retryUpload: (uploadId: string) => Promise<void>;
  cancelUpload: (uploadId: string) => Promise<void>;

  // Real-time updates
  isConnected: boolean;

  // Utility methods
  refreshUploads: () => Promise<void>;
  clearError: () => void;
  getUploadProgress: (uploadId: string) => UploadProgress | undefined;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

interface UploadProviderProps {
  workspaceId: string;
  children: React.ReactNode;
}

export function UploadProvider({ workspaceId, children }: UploadProviderProps) {
  const { user } = useAuth();
  const userId = user?.id;

  // State
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<
    Map<string, UploadProgress>
  >(new Map());
  const [isConnected, setIsConnected] = useState(false);

  // Refs for cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Create services - memoized to prevent recreation
  const uploadService = useMemo(() => new UploadService(pb), []);
  const uploadMutator = useMemo(() => new UploadMutator(pb), []);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Upload ${operation} error:`, error);
    const message =
      error instanceof Error ? error.message : `Failed to ${operation} upload`;
    setError(message);
  }, []);

  // Load uploads from server
  const loadUploads = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    clearError();

    try {
      const result = await uploadMutator.getByWorkspace(workspaceId, 1, 100);
      setUploads(result.items);
    } catch (error) {
      handleError(error, 'load');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, uploadMutator, clearError, handleError]);

  // Refresh uploads
  const refreshUploads = useCallback(async () => {
    await loadUploads();
  }, [loadUploads]);

  // Upload file
  const uploadFile = useCallback(
    async (file: File): Promise<Upload> => {
      if (!workspaceId) throw new Error('No workspace selected');
      if (!userId)
        throw new Error('User must be authenticated to upload files');

      clearError();

      // Create abort controller for this upload
      const abortController = new AbortController();
      const tempId = `temp-${Date.now()}`;
      abortControllersRef.current.set(tempId, abortController);

      // Initialize progress tracking
      setUploadProgress((prev) => {
        const newMap = new Map(prev);
        newMap.set(tempId, {
          uploadId: tempId,
          bytesUploaded: 0,
          totalBytes: file.size,
          percentage: 0,
        });
        return newMap;
      });

      try {
        // Progress callback
        const onProgress = (progress: number | ClientUploadProgress) => {
          const bytesUploaded =
            typeof progress === 'number' ? progress : progress.loaded;
          setUploadProgress((prev) => {
            const newMap = new Map(prev);
            newMap.set(tempId, {
              uploadId: tempId,
              bytesUploaded,
              totalBytes: file.size,
              percentage: Math.round((bytesUploaded / file.size) * 100),
            });
            return newMap;
          });
        };

        // Initiate upload
        const upload = await uploadService.initiateUpload(
          workspaceId,
          file,
          userId,
          onProgress
        );

        // Update progress map with real upload ID
        setUploadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          newMap.set(upload.id, {
            uploadId: upload.id,
            bytesUploaded: file.size,
            totalBytes: file.size,
            percentage: 100,
          });
          return newMap;
        });

        // Clean up abort controller
        abortControllersRef.current.delete(tempId);

        return upload;
      } catch (error) {
        // Clean up progress and abort controller
        setUploadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        });
        abortControllersRef.current.delete(tempId);

        handleError(error, 'upload');
        throw error;
      }
    },
    [workspaceId, uploadService, clearError, handleError, userId]
  );

  // Retry upload
  const retryUpload = useCallback(
    async (uploadId: string) => {
      if (!workspaceId) throw new Error('No workspace selected');

      clearError();

      try {
        await uploadService.retryUpload(uploadId);
        // Refresh uploads to get updated status
        await refreshUploads();
      } catch (error) {
        handleError(error, 'retry');
        throw error;
      }
    },
    [workspaceId, uploadService, refreshUploads, clearError, handleError]
  );

  // Cancel upload
  const cancelUpload = useCallback(
    async (uploadId: string) => {
      clearError();

      try {
        // Abort the upload if it's in progress
        const abortController = abortControllersRef.current.get(uploadId);
        if (abortController) {
          abortController.abort();
          abortControllersRef.current.delete(uploadId);
        }

        // Cancel via service
        await uploadService.cancelUpload(uploadId);

        // Clean up progress
        setUploadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(uploadId);
          return newMap;
        });

        // Refresh uploads to get updated status
        await refreshUploads();
      } catch (error) {
        handleError(error, 'cancel');
        throw error;
      }
    },
    [uploadService, refreshUploads, clearError, handleError]
  );

  // Get upload progress
  const getUploadProgress = useCallback(
    (uploadId: string): UploadProgress | undefined => {
      return uploadProgress.get(uploadId);
    },
    [uploadProgress]
  );

  // Real-time subscription management
  const subscribe = useCallback(async () => {
    if (!workspaceId || unsubscribeRef.current) return;

    try {
      // Subscribe to uploads collection changes for this workspace
      const unsubscribe = await new Promise<() => void>((resolve) => {
        pb.collection('Uploads')
          .subscribe(
            '*',
            (data: RecordSubscription<Upload>) => {
              // Only handle updates for this workspace
              if (data.record.WorkspaceRef !== workspaceId) return;

              // Handle real-time updates
              if (data.action === 'create') {
                setUploads((prev) => {
                  // Avoid duplicates
                  const exists = prev.some(
                    (upload) => upload.id === data.record.id
                  );
                  return exists ? prev : [data.record, ...prev];
                });
              } else if (data.action === 'update') {
                setUploads((prev) =>
                  prev.map((upload) =>
                    upload.id === data.record.id ? data.record : upload
                  )
                );
              } else if (data.action === 'delete') {
                setUploads((prev) =>
                  prev.filter((upload) => upload.id !== data.record.id)
                );
              }
            },
            {
              expand: 'workspace',
            }
          )
          .then(() => {
            setIsConnected(true);
            return () => {
              pb.collection('Uploads').unsubscribe('*');
              setIsConnected(false);
            };
          });

        // Return the unsubscribe function
        resolve(() => {
          pb.collection('Uploads').unsubscribe('*');
          setIsConnected(false);
        });
      });

      unsubscribeRef.current = unsubscribe;
      setIsConnected(true);
    } catch (error) {
      console.error('Upload subscription error:', error);
      setIsConnected(false);
    }
  }, [workspaceId]);

  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Initialize uploads when workspace changes
  useEffect(() => {
    if (workspaceId) {
      loadUploads();
      subscribe();
    } else {
      // Clear uploads when no workspace
      setUploads([]);
      setIsLoading(false);
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [workspaceId, loadUploads, subscribe, unsubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    // Capture the ref value for cleanup
    const abortControllers = abortControllersRef.current;

    return () => {
      // Abort all in-progress uploads
      abortControllers.forEach((controller) => {
        controller.abort();
      });
      abortControllers.clear();

      // Unsubscribe from real-time updates
      unsubscribe();
    };
  }, [unsubscribe]);

  const value: UploadContextType = {
    // State
    uploads,
    isLoading,
    error,
    uploadProgress,

    // Operations
    uploadFile,
    retryUpload,
    cancelUpload,

    // Real-time updates
    isConnected,

    // Utility methods
    refreshUploads,
    clearError,
    getUploadProgress,
  };

  return (
    <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
  );
}

// Export the context for use in the hook
export { UploadContext };
