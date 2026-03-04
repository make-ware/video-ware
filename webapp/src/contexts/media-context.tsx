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

/**
 * Directory filter for media:
 * - null: show all media in workspace
 * - 'root': show only media with no directory assigned
 * - string: show media in specific directory
 */
type DirectoryFilter = string | null;

interface BulkDeleteResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

interface MediaContextType {
  // State
  media: MediaWithPreviews[];
  isLoading: boolean;
  error: string | null;
  directoryFilter: DirectoryFilter;

  // Operations
  getMediaById: (mediaId: string) => MediaWithPreviews | undefined;
  getMediaByUpload: (uploadId: string) => MediaWithPreviews | undefined;
  setDirectoryFilter: (filter: DirectoryFilter) => void;
  bulkDeleteMedia: (mediaIds: string[]) => Promise<BulkDeleteResult>;

  // Real-time updates
  isConnected: boolean;

  // Utility methods
  refreshMedia: () => Promise<void>;
  clearError: () => void;
}

const MediaContext = createContext<MediaContextType | undefined>(undefined);

interface MediaProviderProps {
  workspaceId: string;
  initialDirectoryFilter?: DirectoryFilter;
  children: React.ReactNode;
}

export function MediaProvider({
  workspaceId,
  initialDirectoryFilter = null,
  children,
}: MediaProviderProps) {
  // State
  const [media, setMedia] = useState<MediaWithPreviews[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>(
    initialDirectoryFilter
  );

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
      let result;
      if (directoryFilter === null) {
        result = await mediaService.getMediaByWorkspace(workspaceId);
      } else if (directoryFilter === 'root') {
        result = await mediaService.getMediaByWorkspaceRoot(workspaceId);
      } else {
        result = await mediaService.getMediaByDirectory(directoryFilter);
      }
      setMedia(result);
    } catch (error) {
      handleError(error, 'load');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, directoryFilter, mediaService, clearError, handleError]);

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

  // Bulk delete media
  const bulkDeleteMedia = useCallback(
    async (mediaIds: string[]): Promise<BulkDeleteResult> => {
      try {
        // Optimistically remove from local state
        setMedia((prev) => prev.filter((m) => !mediaIds.includes(m.id)));

        const result = await mediaService.bulkDeleteMedia(mediaIds);

        // If some failed, add them back
        if (result.failed.length > 0) {
          await loadMedia();
        }

        return result;
      } catch (error) {
        handleError(error, 'bulk delete');
        // Reload to restore state
        await loadMedia();
        return {
          succeeded: [],
          failed: mediaIds.map((id) => ({ id, error: 'Bulk delete failed' })),
        };
      }
    },
    [mediaService, loadMedia, handleError]
  );

  // Ref so subscribe handler always sees the latest filter without being in subscribe's deps
  const directoryFilterRef = useRef<DirectoryFilter>(null);
  directoryFilterRef.current = directoryFilter;

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

              // Check if the record matches the current directory filter
              const matchesFilter = (record: Media) => {
                const filter = directoryFilterRef.current;
                if (filter === null) return true;
                if (filter === 'root') return !record.DirectoryRef;
                return record.DirectoryRef === filter;
              };

              // Handle real-time updates
              if (data.action === 'create') {
                if (!matchesFilter(data.record)) return;
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
                // If record no longer matches filter, remove it
                if (!matchesFilter(data.record)) {
                  setMedia((prev) =>
                    prev.filter((m) => m.id !== data.record.id)
                  );
                  return;
                }
                // Fetch updated media with previews
                try {
                  const mediaWithPreviews =
                    await mediaService.getMediaWithPreviews(data.record.id);
                  if (mediaWithPreviews) {
                    setMedia((prev) => {
                      const exists = prev.some((m) => m.id === data.record.id);
                      if (exists) {
                        return prev.map((m) =>
                          m.id === data.record.id ? mediaWithPreviews : m
                        );
                      }
                      return [mediaWithPreviews, ...prev];
                    });
                  }
                } catch (error) {
                  console.error('Failed to fetch media with previews:', error);
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

  // Reload media when workspace or directory filter changes
  useEffect(() => {
    if (workspaceId) {
      loadMedia();
    } else {
      setMedia([]);
      setIsLoading(false);
    }
  }, [workspaceId, loadMedia]);

  // Manage subscription per workspace (stable — subscribe doesn't depend on directoryFilter)
  useEffect(() => {
    if (workspaceId) {
      subscribe();
    }
    return () => {
      unsubscribe();
    };
  }, [workspaceId, subscribe, unsubscribe]);

  const value: MediaContextType = {
    // State
    media,
    isLoading,
    error,
    directoryFilter,

    // Operations
    getMediaById,
    getMediaByUpload,
    setDirectoryFilter,
    bulkDeleteMedia,

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
