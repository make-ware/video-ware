'use client';

import { useState } from 'react';
import {
  TimelineRecommendation,
  RecommendationStrategy,
  MediaClip,
  Media,
} from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Replace, X, Check, Eye, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaBaseCard } from '@/components/media/media-base-card';
import { TimelineClipDetailsDialog } from '@/components/timeline/timeline-clip-details-dialog';

interface TimelineRecommendationCardProps {
  recommendation: TimelineRecommendation;
  onAdd?: (recommendation: TimelineRecommendation) => void;
  onReplace?: (recommendation: TimelineRecommendation) => void;
  onDismiss?: (recommendation: TimelineRecommendation) => void;
  className?: string;
}

/**
 * TimelineRecommendationCard Component
 *
 * Displays a single timeline recommendation with:
 * - Thumbnail/preview area
 * - Clip label/name
 * - Time and Date info
 * - Strategy badge
 * - Action buttons for "Add", "Replace", "Dismiss", and "View Details"
 */
export function TimelineRecommendationCard({
  recommendation,
  onAdd,
  onReplace,
  onDismiss,
  className,
}: TimelineRecommendationCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsClip, setDetailsClip] = useState<any>(null);

  // Get strategy display name
  const getStrategyDisplay = (strategy: RecommendationStrategy): string => {
    const displayMap: Record<RecommendationStrategy, string> = {
      [RecommendationStrategy.SAME_ENTITY]: 'Same Entity',
      [RecommendationStrategy.ADJACENT_SHOT]: 'Adjacent Shot',
      [RecommendationStrategy.TEMPORAL_NEARBY]: 'Nearby',
      [RecommendationStrategy.CONFIDENCE_DURATION]: 'High Confidence',
      [RecommendationStrategy.DIALOG_CLUSTER]: 'Dialog Cluster',
      [RecommendationStrategy.OBJECT_POSITION_MATCHER]:
        'Object Position Matcher',
      [RecommendationStrategy.ACTIVITY_STRATEGY]: 'Activity',
    };
    return displayMap[strategy] || strategy;
  };

  // Get strategy color variant
  const getStrategyVariant = (
    strategy: RecommendationStrategy
  ): 'default' | 'secondary' | 'outline' => {
    const variantMap: Record<
      RecommendationStrategy,
      'default' | 'secondary' | 'outline'
    > = {
      [RecommendationStrategy.SAME_ENTITY]: 'default',
      [RecommendationStrategy.ADJACENT_SHOT]: 'secondary',
      [RecommendationStrategy.TEMPORAL_NEARBY]: 'outline',
      [RecommendationStrategy.CONFIDENCE_DURATION]: 'default',
      [RecommendationStrategy.DIALOG_CLUSTER]: 'default',
      [RecommendationStrategy.OBJECT_POSITION_MATCHER]: 'default',
      [RecommendationStrategy.ACTIVITY_STRATEGY]: 'default',
    };
    return variantMap[strategy] || 'outline';
  };

  // Handle action with loading state
  const handleAction = async (
    action: ((rec: TimelineRecommendation) => void | Promise<void>) | undefined,
    rec: TimelineRecommendation
  ) => {
    if (!action) return;

    setIsProcessing(true);
    try {
      await action(rec);
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds?: number) => {
    if (seconds === undefined) return '--:--';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '--/--/--';
    const date = new Date(dateString);
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}/${month}/${day}`;
  };

  // Normalize strategy to single value
  const strategy = Array.isArray(recommendation.strategy)
    ? recommendation.strategy[0]
    : recommendation.strategy;

  const scorePercentage = Math.round(recommendation.score * 100);

  // Type-safe access to nested expands
  const mediaClip =
    recommendation.expand && 'MediaClipRef' in recommendation.expand
      ? (recommendation.expand.MediaClipRef as MediaClip & {
          expand?: {
            MediaRef?: Media & {
              expand?: {
                UploadRef?: { name?: string };
              };
            };
          };
        })
      : undefined;
  const media = mediaClip?.expand?.MediaRef as Media | undefined;
  const clipStart = mediaClip?.start;
  const clipEnd = mediaClip?.end;

  const mediaName =
    mediaClip?.expand?.MediaRef &&
    'expand' in mediaClip.expand.MediaRef &&
    mediaClip.expand.MediaRef.expand &&
    'UploadRef' in mediaClip.expand.MediaRef.expand
      ? mediaClip.expand.MediaRef.expand.UploadRef?.name
      : undefined;
  const displayName = mediaName || 'Recommended Clip';

  // Check if recommendation is used (has associated timeline clips)
  // We check the direct relation TimelineClipsRef
  const associatedClips = recommendation.expand?.TimelineClipsRef;
  const isUsed = Array.isArray(associatedClips) && associatedClips.length > 0;

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Construct a pseudo-clip for the dialog
    const pseudoClip: any = {
      id: recommendation.id,
      start: clipStart || 0,
      end: clipEnd || 0,
      order: 0,
      meta: {
        reason: recommendation.reason,
        score: recommendation.score,
        strategy: recommendation.strategy,
      },
      expand: {
        MediaRef: media,
        MediaClipRef: mediaClip,
      },
    };
    setDetailsClip(pseudoClip);
    setIsDetailsOpen(true);
  };

  return (
    <>
      <MediaBaseCard
        media={media}
        startTime={clipStart}
        endTime={clipEnd}
        className={cn(
          isProcessing && 'opacity-60 pointer-events-none',
          className
        )}
        title={
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <Badge
              variant={getStrategyVariant(strategy)}
              className="uppercase text-[10px] font-semibold h-5 px-2"
            >
              {getStrategyDisplay(strategy)}
            </Badge>
            <span className="text-[10px] font-medium text-muted-foreground">
              #{recommendation.rank + 1}
            </span>
          </div>
        }
        subtitle={
          <div className="mt-1 flex flex-col gap-1">
            <div className="text-[10px] font-medium truncate opacity-60">
              {displayName}
            </div>
            {/* Time & Date Info */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center justify-between gap-1">
                <span className="opacity-70">In:</span>
                {formatTime(clipStart)}
              </span>
              <span className="flex items-center justify-between gap-1">
                <span className="opacity-70">Out:</span>
                {formatTime(clipEnd)}
              </span>
              <span className="col-span-2 flex items-center gap-1 border-t border-border/50 pt-0.5 mt-0.5">
                <Calendar className="h-2.5 w-2.5 opacity-70" />
                {formatDate(media?.created)}
              </span>
            </div>
          </div>
        }
        leftBadges={
          [
            isUsed && (
              <div
                key="used"
                className="bg-green-500 text-white rounded-full p-1 shadow-lg animate-in zoom-in-50 duration-300"
                title="Timeline clip created"
              >
                <Check className="h-3 w-3" />
              </div>
            ),
          ].filter(Boolean) as React.ReactNode[]
        }
        badges={[
          <Badge
            key="score"
            variant="secondary"
            className="text-[10px] font-semibold h-5 px-2 bg-black/60 text-white border-0"
          >
            {scorePercentage}%
          </Badge>,
        ]}
        overlayActions={
          [
            <Button
              key="details"
              size="icon"
              variant="secondary"
              onClick={handleViewDetails}
              className="h-7 w-7 shadow-md"
              title="View Details"
            >
              <Eye className="h-4 w-4" />
            </Button>,
            recommendation.targetMode === 'append' && onAdd && (
              <Button
                key="add"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onAdd, recommendation);
                }}
                disabled={isProcessing}
                className="h-7 w-7 shadow-md"
                title="Add to Timeline"
              >
                <Plus className="h-4 w-4" />
              </Button>
            ),
            recommendation.targetMode === 'replace' && onReplace && (
              <Button
                key="replace"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onReplace, recommendation);
                }}
                disabled={isProcessing}
                className="h-7 w-7 shadow-md"
                title="Replace Clip"
              >
                <Replace className="h-4 w-4" />
              </Button>
            ),
            onDismiss && (
              <Button
                key="dismiss"
                size="icon"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onDismiss, recommendation);
                }}
                disabled={isProcessing}
                className="h-7 w-7 shadow-md"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </Button>
            ),
          ].filter(Boolean) as React.ReactNode[]
        }
      />
      {detailsClip && (
        <TimelineClipDetailsDialog
          open={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          clip={detailsClip}
        />
      )}
    </>
  );
}
