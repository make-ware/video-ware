'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { Media } from '@project/shared';
import { MediaService } from '@/services/media';
import pb from '@/lib/pocketbase-client';
import type { RecordSubscription } from 'pocketbase';

interface MediaWithPreviews extends Media {
  thumbnailUrl?: string;
  spriteUrl?: string;
}

interface MediaContextType {
  // State
  media: MediaWithPreviews[];
  isLoading: boolean;
  error: string | null;

  // Operations
  getMediaById: (mediaId: string) => MediaWithPreviews | undefined;
  getMediaByUpload: (uploadId: string) => MediaWithPreviews | undefined;

  // Real-time updates
  isConnected: boolean;

  // Utility methods
  refreshMedia: () => Promise<void>;
  clearError: () => void;
}

const MediaContext = createContext<MediaContextType | undefined>(undefined);

interface MediaProviderProps {
  workspaceId: string;
  children: React.ReactNode;
}

export function MediaProvider({ workspaceId, children }: MediaProviderProps) {
  // State
  const [media, setMedia] = useState<MediaWithPreviews[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Create services - memoized to prevent recreation
  const mediaService = useMemo(() => new MediaService(pb), []);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Media ${operation} error:`, error);
    const message =
      error instanceof Error ? error.message : `Failed to ${operation} media`;
    setError(message);
  }, []);

  // Load media from server
  const loadMedia = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    clearError();

    try {
      const result = await mediaService.getMediaByWorkspace(workspaceId);
      setMedia(result);
    } catch (error) {
      handleError(error, 'load');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, mediaService, clearError, handleError]);

  // Refresh media
  const refreshMedia = useCallback(async () => {
    await loadMedia();
  }, [loadMedia]);

  // Get media by ID
  const getMediaById = useCallback(
    (mediaId: string): MediaWithPreviews | undefined => {
      return media.find((m) => m.id === mediaId);
    },
    [media]
  );

  // Get media by upload ID
  const getMediaByUpload = useCallback(
    (uploadId: string): MediaWithPreviews | undefined => {
      return media.find((m) => m.UploadRef === uploadId);
    },
    [media]
  );

  // Real-time subscription management
  const subscribe = useCallback(async () => {
    if (!workspaceId || unsubscribeRef.current) return;

    try {
      // Subscribe to media collection changes for this workspace
      const unsubscribe = await new Promise<() => void>((resolve) => {
        pb.collection('Media')
          .subscribe(
            '*',
            async (data: RecordSubscription<Media>) => {
              // Only handle updates for this workspace
              if (data.record.WorkspaceRef !== workspaceId) return;

              // Handle real-time updates
              if (data.action === 'create') {
                // Fetch with previews
                try {
                  const mediaWithPreviews =
                    await mediaService.getMediaWithPreviews(data.record.id);
                  if (mediaWithPreviews) {
                    setMedia((prev) => {
                      // Avoid duplicates
                      const exists = prev.some((m) => m.id === data.record.id);
                      return exists ? prev : [mediaWithPreviews, ...prev];
                    });
                  }
                } catch (error) {
                  console.error('Failed to fetch media with previews:', error);
                  // Fall back to adding without previews
                  setMedia((prev) => {
                    const exists = prev.some((m) => m.id === data.record.id);
                    return exists ? prev : [data.record, ...prev];
                  });
                }
              } else if (data.action === 'update') {
                // Fetch updated media with previews
                try {
                  const mediaWithPreviews =
                    await mediaService.getMediaWithPreviews(data.record.id);
                  if (mediaWithPreviews) {
                    setMedia((prev) =>
                      prev.map((m) =>
                        m.id === data.record.id ? mediaWithPreviews : m
                      )
                    );
                  }
                } catch (error) {
                  console.error('Failed to fetch media with previews:', error);
                  // Fall back to updating without previews
                  setMedia((prev) =>
                    prev.map((m) => (m.id === data.record.id ? data.record : m))
                  );
                }
              } else if (data.action === 'delete') {
                setMedia((prev) => prev.filter((m) => m.id !== data.record.id));
              }
            },
            {
              expand:
                'WorkspaceRef,UploadRef,thumbnailFileRef,spriteFileRef,proxyFileRef',
            }
          )
          .then(() => {
            setIsConnected(true);
            return () => {
              pb.collection('Media').unsubscribe('*');
              setIsConnected(false);
            };
          });

        // Return the unsubscribe function
        resolve(() => {
          pb.collection('Media').unsubscribe('*');
          setIsConnected(false);
        });
      });

      unsubscribeRef.current = unsubscribe;
      setIsConnected(true);
    } catch (error) {
      console.error('Media subscription error:', error);
      setIsConnected(false);
    }
  }, [workspaceId, mediaService]);

  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Initialize media when workspace changes
  useEffect(() => {
    if (workspaceId) {
      loadMedia();
      subscribe();
    } else {
      // Clear media when no workspace
      setMedia([]);
      setIsLoading(false);
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [workspaceId, loadMedia, subscribe, unsubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  const value: MediaContextType = {
    // State
    media,
    isLoading,
    error,

    // Operations
    getMediaById,
    getMediaByUpload,

    // Real-time updates
    isConnected,

    // Utility methods
    refreshMedia,
    clearError,
  };

  return (
    <MediaContext.Provider value={value}>{children}</MediaContext.Provider>
  );
}

// Export the context for use in the hook
export { MediaContext };
