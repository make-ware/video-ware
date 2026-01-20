'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { TimelineRecommendation, TimelineClip } from '@project/shared';
import {
  RecommendationStrategy,
  RecommendationTargetMode,
  LabelType,
} from '@project/shared';
import { TimelineRecommendationMutator } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import type { RecordSubscription } from 'pocketbase';

interface TimelineRecommendationContextType {
  // State
  recommendations: TimelineRecommendation[];
  isLoading: boolean;
  error: string | null;

  // Filtering state
  selectedStrategies: RecommendationStrategy[];
  targetMode: RecommendationTargetMode | null;
  excludeAccepted: boolean;
  excludeDismissed: boolean;

  // Operations
  fetchRecommendations: (timelineId: string) => Promise<void>;
  acceptRecommendation: (
    id: string,
    options?: { order?: number }
  ) => Promise<{
    recommendation: TimelineRecommendation;
    timelineClip: TimelineClip;
  }>;
  dismissRecommendation: (id: string) => Promise<void>;
  generateRecommendations: (
    params: GenerateTimelineRecommendationsParams
  ) => Promise<void>;

  // Filtering operations
  filterByStrategy: (strategy: RecommendationStrategy) => void;
  clearStrategyFilter: () => void;
  setStrategyFilter: (strategies: RecommendationStrategy[]) => void;
  setTargetMode: (mode: RecommendationTargetMode | null) => void;
  toggleExcludeAccepted: () => void;
  toggleExcludeDismissed: () => void;

  // Real-time updates
  isConnected: boolean;

  // Utility methods
  refreshRecommendations: () => Promise<void>;
  clearError: () => void;
}

interface GenerateTimelineRecommendationsParams {
  timelineId: string;
  seedClipId?: string;
  targetMode: RecommendationTargetMode;
  strategies?: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  searchParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
    timeWindow?: number;
  };
  maxResults?: number;
}

const TimelineRecommendationContext = createContext<
  TimelineRecommendationContextType | undefined
>(undefined);

interface TimelineRecommendationProviderProps {
  timelineId?: string;
  children: React.ReactNode;
}

export function TimelineRecommendationProvider({
  timelineId,
  children,
}: TimelineRecommendationProviderProps) {
  // State
  const [recommendations, setRecommendations] = useState<
    TimelineRecommendation[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Filtering state
  const [selectedStrategies, setSelectedStrategies] = useState<
    RecommendationStrategy[]
  >([]);
  const [targetMode, setTargetModeState] =
    useState<RecommendationTargetMode | null>(null);
  const [excludeAccepted, setExcludeAccepted] = useState(true); // Default to excluding accepted
  const [excludeDismissed, setExcludeDismissed] = useState(true); // Default to excluding dismissed

  // Refs for cleanup and tracking
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const currentTimelineIdRef = useRef<string | undefined>(timelineId);

  // Create mutator - memoized to prevent recreation
  const mutator = useMemo(() => new TimelineRecommendationMutator(pb), []);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Timeline recommendation ${operation} error:`, error);
    const message =
      error instanceof Error
        ? error.message
        : `Failed to ${operation} timeline recommendations`;
    setError(message);
  }, []);

  // Load recommendations from server
  const fetchRecommendations = useCallback(
    async (targetTimelineId: string) => {
      if (!targetTimelineId) {
        setRecommendations([]);
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        // Build filter options
        const options: {
          excludeAccepted?: boolean;
          excludeDismissed?: boolean;
          strategy?: RecommendationStrategy;
          targetMode?: RecommendationTargetMode;
        } = {
          excludeAccepted,
          excludeDismissed,
        };

        if (targetMode) {
          options.targetMode = targetMode;
        }

        // If strategies are selected, fetch for each and combine
        if (selectedStrategies.length > 0) {
          const promises = selectedStrategies.map((strategy) =>
            mutator.getByTimeline(
              targetTimelineId,
              { ...options, strategy },
              1,
              100
            )
          );
          const results = await Promise.all(promises);
          const allItems = results.flatMap((r) => r.items);

          // Sort by rank and score
          allItems.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return b.score - a.score; // Higher score first
          });

          setRecommendations(allItems);
        } else {
          // Fetch all recommendations for the timeline
          const result = await mutator.getByTimeline(
            targetTimelineId,
            options,
            1,
            100
          );
          setRecommendations(result.items);
        }
      } catch (error) {
        handleError(error, 'fetch');
        setRecommendations([]);
      } finally {
        setIsLoading(false);
      }
    },
    [
      mutator,
      selectedStrategies,
      targetMode,
      excludeAccepted,
      excludeDismissed,
      clearError,
      handleError,
    ]
  );

  // Generate recommendations by calling the new on-demand API
  const generateRecommendations = useCallback(
    async (params: GenerateTimelineRecommendationsParams) => {
      const { timelineId, seedClipId, maxResults = 10 } = params;

      if (!timelineId) {
        setError('Timeline ID is required to generate recommendations');
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        // Get workspace from timeline
        const timeline = await pb.collection('Timelines').getOne(timelineId);
        const workspaceId = timeline.WorkspaceRef;

        const urlParams = new URLSearchParams({
          workspaceId,
          timelineId,
          maxResults: maxResults.toString(),
        });

        if (seedClipId) {
          urlParams.set('seedClipId', seedClipId);
        }

        const token = pb.authStore.token;
        if (!token) {
          throw new Error(
            'User must be authenticated to generate recommendations'
          );
        }

        const response = await fetch(
          `/api-next/recommendations/timeline?${urlParams.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || 'Failed to generate recommendations'
          );
        }

        const data = await response.json();
        setRecommendations((prev) => {
          const newItems = (data.items || []) as TimelineRecommendation[];
          // Merge new items into existing, updating if exists, adding if not
          const merged = [...prev];
          newItems.forEach((newItem) => {
            const index = merged.findIndex((r) => r.id === newItem.id);
            if (index >= 0) {
              merged[index] = newItem;
            } else {
              merged.push(newItem);
            }
          });

          // Re-sort
          merged.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return b.score - a.score;
          });

          return merged;
        });
      } catch (error) {
        handleError(error, 'generate');
      } finally {
        setIsLoading(false);
      }
    },
    [clearError, handleError]
  );

  // Refresh recommendations
  const refreshRecommendations = useCallback(async () => {
    if (currentTimelineIdRef.current) {
      await generateRecommendations({
        timelineId: currentTimelineIdRef.current,
        targetMode: RecommendationTargetMode.APPEND, // Default mode
      });
    }
  }, [generateRecommendations]);

  // Accept a recommendation
  const acceptRecommendation = useCallback(
    async (
      id: string,
      options?: { order?: number }
    ): Promise<{
      recommendation: TimelineRecommendation;
      timelineClip: TimelineClip;
    }> => {
      clearError();
      try {
        const result = await mutator.acceptRecommendation(id, options);

        // Update local state - remove the accepted recommendation if excludeAccepted is true
        if (excludeAccepted) {
          setRecommendations((prev) => prev.filter((r) => r.id !== id));
        } else {
          // Update the recommendation in the list
          setRecommendations((prev) =>
            prev.map((r) => (r.id === id ? result.recommendation : r))
          );
        }

        return result;
      } catch (error) {
        handleError(error, 'accept');
        throw error;
      }
    },
    [mutator, excludeAccepted, clearError, handleError]
  );

  // Dismiss a recommendation
  const dismissRecommendation = useCallback(
    async (id: string): Promise<void> => {
      clearError();
      try {
        const updated = await mutator.dismissRecommendation(id);

        // Update local state - remove the dismissed recommendation if excludeDismissed is true
        if (excludeDismissed) {
          setRecommendations((prev) => prev.filter((r) => r.id !== id));
        } else {
          // Update the recommendation in the list
          setRecommendations((prev) =>
            prev.map((r) => (r.id === id ? updated : r))
          );
        }
      } catch (error) {
        handleError(error, 'dismiss');
        throw error;
      }
    },
    [mutator, excludeDismissed, clearError, handleError]
  );

  // Filter by strategy (toggle)
  const filterByStrategy = useCallback((strategy: RecommendationStrategy) => {
    setSelectedStrategies((prev) => {
      if (prev.includes(strategy)) {
        // Remove if already selected
        return prev.filter((s) => s !== strategy);
      } else {
        // Add if not selected
        return [...prev, strategy];
      }
    });
  }, []);

  // Clear strategy filter
  const clearStrategyFilter = useCallback(() => {
    setSelectedStrategies([]);
  }, []);

  // Set strategy filter (replace)
  const setStrategyFilter = useCallback(
    (strategies: RecommendationStrategy[]) => {
      setSelectedStrategies(strategies);
    },
    []
  );

  // Set target mode
  const setTargetMode = useCallback((mode: RecommendationTargetMode | null) => {
    setTargetModeState(mode);
  }, []);

  // Toggle exclude accepted
  const toggleExcludeAccepted = useCallback(() => {
    setExcludeAccepted((prev) => !prev);
  }, []);

  // Toggle exclude dismissed
  const toggleExcludeDismissed = useCallback(() => {
    setExcludeDismissed((prev) => !prev);
  }, []);

  // Real-time subscription management
  const subscribe = useCallback(
    async (targetTimelineId: string) => {
      if (!targetTimelineId || unsubscribeRef.current) return;

      try {
        // Subscribe to TimelineRecommendations collection changes for this timeline
        const unsubscribe = await new Promise<() => void>((resolve) => {
          pb.collection('TimelineRecommendations')
            .subscribe(
              '*',
              async (data: RecordSubscription<TimelineRecommendation>) => {
                // Only handle updates for this timeline
                if (data.record.TimelineRef !== targetTimelineId) return;

                // Handle real-time updates
                if (data.action === 'create') {
                  setRecommendations((prev) => {
                    // Avoid duplicates
                    const exists = prev.some((r) => r.id === data.record.id);
                    if (exists) return prev;

                    // Check if we should include this recommendation based on filters
                    if (excludeAccepted && data.record.acceptedAt) return prev;
                    if (excludeDismissed && data.record.dismissedAt)
                      return prev;
                    if (
                      selectedStrategies.length > 0 &&
                      !selectedStrategies.includes(
                        data.record.strategy as RecommendationStrategy
                      )
                    ) {
                      return prev;
                    }
                    if (targetMode && data.record.targetMode !== targetMode) {
                      return prev;
                    }

                    // Add and re-sort by rank and score
                    const updated = [...prev, data.record];
                    updated.sort((a, b) => {
                      if (a.rank !== b.rank) return a.rank - b.rank;
                      return b.score - a.score; // Higher score first
                    });
                    return updated;
                  });
                } else if (data.action === 'update') {
                  setRecommendations((prev) => {
                    // Check if we should remove this recommendation based on filters
                    if (excludeAccepted && data.record.acceptedAt) {
                      return prev.filter((r) => r.id !== data.record.id);
                    }
                    if (excludeDismissed && data.record.dismissedAt) {
                      return prev.filter((r) => r.id !== data.record.id);
                    }

                    const updated = prev.map((r) =>
                      r.id === data.record.id ? data.record : r
                    );
                    // Re-sort in case rank changed
                    updated.sort((a, b) => {
                      if (a.rank !== b.rank) return a.rank - b.rank;
                      return b.score - a.score; // Higher score first
                    });
                    return updated;
                  });
                } else if (data.action === 'delete') {
                  setRecommendations((prev) =>
                    prev.filter((r) => r.id !== data.record.id)
                  );
                }
              },
              {
                expand:
                  'WorkspaceRef,TimelineRef,TimelineClipsRef,SeedClipRef,MediaClipRef',
              }
            )
            .then(() => {
              setIsConnected(true);
              return () => {
                pb.collection('TimelineRecommendations').unsubscribe('*');
                setIsConnected(false);
              };
            });

          // Return the unsubscribe function
          resolve(() => {
            pb.collection('TimelineRecommendations').unsubscribe('*');
            setIsConnected(false);
          });
        });

        unsubscribeRef.current = unsubscribe;
        setIsConnected(true);
      } catch (error) {
        console.error('Timeline recommendation subscription error:', error);
        setIsConnected(false);
      }
    },
    [excludeAccepted, excludeDismissed, selectedStrategies, targetMode]
  );

  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Initialize recommendations when timelineId changes
  useEffect(() => {
    currentTimelineIdRef.current = timelineId;

    if (timelineId) {
      fetchRecommendations(timelineId);
      subscribe(timelineId);
    } else {
      // Clear recommendations when no timeline
      setRecommendations([]);
      setIsLoading(false);
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [timelineId, fetchRecommendations, subscribe, unsubscribe]);

  // Re-fetch when filter options change
  useEffect(() => {
    if (currentTimelineIdRef.current) {
      fetchRecommendations(currentTimelineIdRef.current);
    }
  }, [
    selectedStrategies,
    targetMode,
    excludeAccepted,
    excludeDismissed,
    fetchRecommendations,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  const value: TimelineRecommendationContextType = {
    // State
    recommendations,
    isLoading,
    error,

    // Filtering state
    selectedStrategies,
    targetMode,
    excludeAccepted,
    excludeDismissed,

    // Operations
    fetchRecommendations,
    acceptRecommendation,
    dismissRecommendation,
    generateRecommendations,

    // Filtering operations
    filterByStrategy,
    clearStrategyFilter,
    setStrategyFilter,
    setTargetMode,
    toggleExcludeAccepted,
    toggleExcludeDismissed,

    // Real-time updates
    isConnected,

    // Utility methods
    refreshRecommendations,
    clearError,
  };

  return (
    <TimelineRecommendationContext.Provider value={value}>
      {children}
    </TimelineRecommendationContext.Provider>
  );
}

// Export the context for use in the hook
export { TimelineRecommendationContext };
