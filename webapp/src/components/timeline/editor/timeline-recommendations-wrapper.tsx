'use client';

import React, { useMemo, useEffect, useRef } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { useTimelineRecommendations } from '@/hooks/use-timeline-recommendations';
import { TimelineRecommendationsPanel } from '@/components/recommendations/timeline-recommendations-panel';
import {
  type TimelineRecommendation,
  RecommendationTargetMode,
} from '@project/shared';

export function TimelineRecommendationsPanelWrapper() {
  const {
    selectedClipId,
    removeClip,
    timeline,
    refreshTimeline,
    reorderClips,
  } = useTimeline();
  const {
    recommendations,
    isLoading,
    acceptRecommendation,
    dismissRecommendation,
    generateRecommendations,
  } = useTimelineRecommendations();

  // Track which clips we have requested recommendations for to avoid infinite loops
  const requestedClipIds = useRef<Set<string>>(new Set());
  // Track if a generation request is in-flight to prevent race conditions
  const isGeneratingRef = useRef(false);

  const lastClipId = useMemo(() => {
    if (timeline && timeline.clips.length > 0) {
      const sortedClips = [...timeline.clips].sort((a, b) => a.order - b.order);
      return sortedClips[sortedClips.length - 1].id;
    }
    return null;
  }, [timeline]);

  // Filter recommendations for the end of the timeline (Primary)
  const timelineRecs = useMemo(() => {
    if (!lastClipId) return [];
    return recommendations.filter((r) => r.SeedClipRef === lastClipId);
  }, [recommendations, lastClipId]);

  // Filter recommendations for the selected clip (Secondary)
  const selectedRecs = useMemo(() => {
    if (!selectedClipId || selectedClipId === lastClipId) return [];
    return recommendations.filter((r) => r.SeedClipRef === selectedClipId);
  }, [recommendations, selectedClipId, lastClipId]);

  // Trigger generation for last clip if needed
  useEffect(() => {
    if (
      timeline &&
      lastClipId &&
      !requestedClipIds.current.has(lastClipId) &&
      timelineRecs.length === 0 &&
      !isLoading &&
      !isGeneratingRef.current
    ) {
      requestedClipIds.current.add(lastClipId);
      isGeneratingRef.current = true;
      generateRecommendations({
        timelineId: timeline.id,
        seedClipId: lastClipId,
        targetMode: RecommendationTargetMode.APPEND,
      })
        .catch((err) => {
          console.error('Failed to generate timeline recommendations:', err);
          // Allow retrying later if needed
          requestedClipIds.current.delete(lastClipId);
        })
        .finally(() => {
          isGeneratingRef.current = false;
        });
    }
  }, [
    timeline,
    lastClipId,
    timelineRecs.length,
    isLoading,
    generateRecommendations,
  ]);

  // Trigger generation for selected clip if needed
  useEffect(() => {
    if (
      timeline &&
      selectedClipId &&
      selectedClipId !== lastClipId &&
      !requestedClipIds.current.has(selectedClipId) &&
      selectedRecs.length === 0 &&
      !isLoading &&
      !isGeneratingRef.current
    ) {
      requestedClipIds.current.add(selectedClipId);
      isGeneratingRef.current = true;
      generateRecommendations({
        timelineId: timeline.id,
        seedClipId: selectedClipId,
        targetMode: RecommendationTargetMode.APPEND,
      })
        .catch((err) => {
          console.error(
            'Failed to generate selected clip recommendations:',
            err
          );
          requestedClipIds.current.delete(selectedClipId);
        })
        .finally(() => {
          isGeneratingRef.current = false;
        });
    }
  }, [
    timeline,
    selectedClipId,
    lastClipId,
    selectedRecs.length,
    isLoading,
    generateRecommendations,
  ]);

  const handleAdd = async (recommendation: TimelineRecommendation) => {
    try {
      // Determine if this recommendation is for a selected clip (not the last clip)
      const seedClipId = recommendation.SeedClipRef;
      const isSelectedClipRecommendation =
        seedClipId &&
        selectedClipId &&
        seedClipId === selectedClipId &&
        seedClipId !== lastClipId;

      let targetOrder: number | undefined;

      if (isSelectedClipRecommendation && timeline) {
        // Find the selected clip to get its order
        const selectedClip = timeline.clips.find(
          (c) => c.id === selectedClipId
        );
        if (selectedClip) {
          // Sort clips by order to handle gaps and potential duplicates
          const sortedClips = [...timeline.clips].sort(
            (a, b) => a.order - b.order
          );
          const selectedIndex = sortedClips.findIndex(
            (c) => c.id === selectedClipId
          );

          if (selectedIndex !== -1) {
            // Calculate target order: insert after selected clip's position
            // Use index-based calculation to ensure sequential ordering
            const calculatedOrder = selectedIndex + 1;
            targetOrder = calculatedOrder;

            // Normalize and shift: assign sequential orders to clips at/after insertion point
            // This prevents gaps and duplicate orders
            const clipsToReorder = sortedClips
              .slice(calculatedOrder)
              .map((c, idx) => ({
                id: c.id,
                order: calculatedOrder + idx + 1,
              }));

            if (clipsToReorder.length > 0) {
              // If reordering fails, abort to prevent order conflicts
              // The try-catch will handle the error and prevent acceptRecommendation
              await reorderClips(clipsToReorder);
            }
          }
        }
      }

      // Accept the recommendation with the calculated order (or undefined to append to end)
      // Only reached if reorderClips succeeded (or wasn't needed)
      await acceptRecommendation(
        recommendation.id,
        targetOrder ? { order: targetOrder } : undefined
      );
      // Ensure the timeline editor immediately reflects the newly added clip
      await refreshTimeline();
    } catch (error) {
      console.error('Failed to add recommendation:', error);
      alert(error instanceof Error ? error.message : 'Failed to add clip');
    }
  };

  const handleReplace = async (recommendation: TimelineRecommendation) => {
    // Determine target clip: use SeedClipRef if available, otherwise selectedClipId or lastClipId
    const targetClipId =
      recommendation.SeedClipRef || selectedClipId || lastClipId;

    if (!targetClipId) {
      alert('No clip available to replace');
      return;
    }
    try {
      await removeClip(targetClipId);
      await acceptRecommendation(recommendation.id);
      // Ensure the timeline editor immediately reflects the newly added replacement clip
      await refreshTimeline();
    } catch (error) {
      console.error('Failed to replace clip:', error);
      alert(error instanceof Error ? error.message : 'Failed to replace clip');
    }
  };

  const handleDismiss = async (recommendation: TimelineRecommendation) => {
    try {
      await dismissRecommendation(recommendation.id);
    } catch (error) {
      console.error('Failed to dismiss recommendation:', error);
    }
  };

  const handleRefresh = async () => {
    if (!timeline) return;

    try {
      // Refresh timeline recommendations
      if (lastClipId) {
        requestedClipIds.current.delete(lastClipId);
        await generateRecommendations({
          timelineId: timeline.id,
          seedClipId: lastClipId,
          targetMode: RecommendationTargetMode.APPEND,
        });
      }

      // Refresh selected clip recommendations if applicable
      if (selectedClipId && selectedClipId !== lastClipId) {
        requestedClipIds.current.delete(selectedClipId);
        await generateRecommendations({
          timelineId: timeline.id,
          seedClipId: selectedClipId,
          targetMode: RecommendationTargetMode.APPEND,
        });
      }

      // If neither (empty timeline), generate generic ones?
      if (!lastClipId && !selectedClipId) {
        await generateRecommendations({
          timelineId: timeline.id,
          targetMode: RecommendationTargetMode.APPEND,
        });
      }
    } catch (error) {
      console.error('Failed to refresh recommendations:', error);
    }
  };

  return (
    <TimelineRecommendationsPanel
      recommendations={timelineRecs}
      selectedClipRecommendations={selectedRecs}
      isLoading={isLoading}
      onAdd={handleAdd}
      onReplace={handleReplace}
      onDismiss={handleDismiss}
      onMoreLikeThis={handleRefresh}
    />
  );
}
