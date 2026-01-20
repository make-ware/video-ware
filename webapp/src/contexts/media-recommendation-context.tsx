'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  MediaRecommendation,
  TimelineRecommendation,
  LabelType,
} from '@project/shared';
import {
  MediaRecommendationMutator,
  TimelineRecommendationMutator,
} from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';

interface MediaRecommendationContextType {
  // State
  recommendations: MediaRecommendation[];
  timelineRecommendations: TimelineRecommendation[];
  isLoading: boolean;
  error: string | null;

  // Filtering state
  selectedLabelTypes: LabelType[];

  // Operations
  fetchRecommendations: (mediaId: string, workspaceId: string) => Promise<void>;
  filterByLabelType: (labelType: LabelType) => void;
  clearLabelTypeFilter: () => void;
  setLabelTypeFilter: (labelTypes: LabelType[]) => void;
  generateRecommendations: (
    mediaId: string,
    workspaceId: string
  ) => Promise<void>;

  // Utility methods
  refreshRecommendations: () => Promise<void>;
  clearError: () => void;
}

const MediaRecommendationContext = createContext<
  MediaRecommendationContextType | undefined
>(undefined);

interface MediaRecommendationProviderProps {
  mediaId?: string;
  timelineId?: string;
  children: React.ReactNode;
}

export function MediaRecommendationProvider({
  mediaId,
  timelineId,
  children,
}: MediaRecommendationProviderProps) {
  // State
  const [recommendations, setRecommendations] = useState<MediaRecommendation[]>(
    []
  );
  const [timelineRecommendations, setTimelineRecommendations] = useState<
    TimelineRecommendation[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabelTypes, setSelectedLabelTypes] = useState<LabelType[]>([]);

  // Refs for tracking
  const currentMediaIdRef = useRef<string | undefined>(mediaId);
  const currentWorkspaceIdRef = useRef<string | undefined>(undefined);

  const mediaMutator = useMemo(() => new MediaRecommendationMutator(pb), []);
  const timelineMutator = useMemo(
    () => new TimelineRecommendationMutator(pb),
    []
  );

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Media recommendation ${operation} error:`, error);
    const message =
      error instanceof Error
        ? error.message
        : `Failed to ${operation} media recommendations`;
    setError(message);
  }, []);

  // Load recommendations from server
  const fetchRecommendations = useCallback(
    async (targetMediaId: string, targetWorkspaceId: string) => {
      if (!targetMediaId || !targetWorkspaceId) {
        setRecommendations([]);
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        const params = new URLSearchParams({
          mediaId: targetMediaId,
          workspaceId: targetWorkspaceId,
        });

        const token = pb.authStore.token;
        if (!token) {
          throw new Error(
            'User must be authenticated to fetch recommendations'
          );
        }

        const response = await fetch(
          `/api-next/recommendations/media?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (!response.ok) {
          throw new Error('Failed to fetch recommendations');
        }

        const data = await response.json();
        setRecommendations(data.items || []);
      } catch (error) {
        handleError(error, 'fetch');
        setRecommendations([]);
      } finally {
        setIsLoading(false);
      }
    },
    [clearError, handleError]
  );

  // Fetch directly from database
  const loadFromDatabase = useCallback(
    async (targetMediaId: string) => {
      setIsLoading(true);
      clearError();
      try {
        // Fetch media recommendations
        const mediaResults = await mediaMutator.getByMedia(targetMediaId);
        console.log('Media recommendations:', mediaResults);
        setRecommendations(mediaResults.items);
      } catch (error) {
        handleError(error, 'load-db');
        setRecommendations([]);
      } finally {
        setIsLoading(false);
      }
    },
    [mediaMutator, clearError, handleError]
  );

  const loadTimelineFromDatabase = useCallback(
    async (targetTimelineId: string) => {
      setIsLoading(true);
      clearError();
      try {
        const results = await timelineMutator.getByTimeline(targetTimelineId);
        console.log('Timeline recommendations:', results);
        setTimelineRecommendations(results.items);
      } catch (error) {
        handleError(error, 'load-timeline-db');
        setTimelineRecommendations([]);
      } finally {
        setIsLoading(false);
      }
    },
    [timelineMutator, clearError, handleError]
  );

  // Refresh recommendations
  const refreshRecommendations = useCallback(async () => {
    if (currentMediaIdRef.current && currentWorkspaceIdRef.current) {
      await fetchRecommendations(
        currentMediaIdRef.current,
        currentWorkspaceIdRef.current
      );
    }
  }, [fetchRecommendations]);

  // Filter by label type (toggle)
  const filterByLabelType = useCallback((labelType: LabelType) => {
    setSelectedLabelTypes((prev) => {
      if (prev.includes(labelType)) {
        // Remove if already selected
        return prev.filter((t) => t !== labelType);
      } else {
        // Add if not selected
        return [...prev, labelType];
      }
    });
  }, []);

  // Clear label type filter
  const clearLabelTypeFilter = useCallback(() => {
    setSelectedLabelTypes([]);
  }, []);

  // Set label type filter (replace)
  const setLabelTypeFilter = useCallback((labelTypes: LabelType[]) => {
    setSelectedLabelTypes(labelTypes);
  }, []);

  // Generate recommendations (now same as fetch)
  const generateRecommendations = useCallback(
    async (targetMediaId: string, targetWorkspaceId: string) => {
      await fetchRecommendations(targetMediaId, targetWorkspaceId);
    },
    [fetchRecommendations]
  );

  // Automated fetch whenever IDs are available
  useEffect(() => {
    if (mediaId) {
      loadFromDatabase(mediaId);
    } else {
      setRecommendations([]);
    }

    if (timelineId) {
      loadTimelineFromDatabase(timelineId);
    } else {
      setTimelineRecommendations([]);
    }

    if (!mediaId && !timelineId) {
      setIsLoading(false);
    }
  }, [mediaId, timelineId, loadFromDatabase, loadTimelineFromDatabase]);

  const value: MediaRecommendationContextType = {
    // State
    recommendations,
    timelineRecommendations,
    isLoading,
    error,

    // Filtering state
    selectedLabelTypes,

    // Operations
    fetchRecommendations,
    filterByLabelType,
    clearLabelTypeFilter,
    setLabelTypeFilter,
    generateRecommendations,

    // Utility methods
    refreshRecommendations,
    clearError,
  };

  return (
    <MediaRecommendationContext.Provider value={value}>
      {children}
    </MediaRecommendationContext.Provider>
  );
}

// Export the context for use in the hook
export { MediaRecommendationContext };
