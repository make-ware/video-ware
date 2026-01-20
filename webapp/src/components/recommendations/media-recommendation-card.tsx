'use client';

import {
  Media,
  MediaRecommendation,
  RecommendationStrategy,
} from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Clock, Play, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaRecommendationCardProps {
  recommendation: MediaRecommendation;
  media?: Media;
  selected?: boolean;
  onSelect?: (recommendation: MediaRecommendation) => void;
  onCreateClip?: (recommendation: MediaRecommendation) => void;
  className?: string;
}

/**
 * MediaRecommendationCard Component
 *
 * Displays a single media recommendation with:
 * - Thumbnail/preview area
 * - Time range display
 * - Label type badge
 * - Reason text explaining the recommendation
 * - Clickable card that selects and previews the recommendation
 * - Create clip icon button
 *
 * Requirements: 10.2, 10.3, 10.4
 */
import { MediaBaseCard } from '@/components/media/media-base-card';

export function MediaRecommendationCard({
  recommendation,
  media,
  selected = false,
  onSelect,
  onCreateClip,
  className,
}: MediaRecommendationCardProps) {
  // Calculate duration
  const duration = recommendation.end - recommendation.start;

  // Normalize strategy to single value
  const strategy = Array.isArray(recommendation.strategy)
    ? recommendation.strategy[0]
    : recommendation.strategy;

  const getStrategyDisplay = (value?: RecommendationStrategy): string => {
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
    if (!value) return 'Recommendation';
    return displayMap[value] || value;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Check if recommendation is used (has associated clips)
  // We check the direct relation MediaClipsRef
  const associatedClips = recommendation.expand?.MediaClipsRef;
  const isUsed = Array.isArray(associatedClips) && associatedClips.length > 0;

  return (
    <MediaBaseCard
      media={media}
      startTime={recommendation.start}
      endTime={recommendation.end}
      className={cn(
        'group transition-all duration-300',
        selected && 'border-primary ring-2 ring-primary/20 bg-primary/5',
        className
      )}
      onSelect={() => onSelect?.(recommendation)}
      title={
        <div className="flex items-center gap-2">
          <Badge
            variant="default"
            className="uppercase text-[10px] font-bold h-5 px-1.5 bg-background/80 backdrop-blur-sm"
          >
            {getStrategyDisplay(strategy)}
          </Badge>
          <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm px-1.5 h-5 rounded-md">
            <Clock className="h-3 w-3" />
            {duration.toFixed(1)}s
          </div>
        </div>
      }
      subtitle={
        <div className="mt-1">
          <p className="text-[11px] leading-tight text-foreground/90 font-medium line-clamp-2">
            {recommendation.reason}
          </p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
              {formatTime(recommendation.start)} —{' '}
              {formatTime(recommendation.end)}
            </span>
            <span className="text-[10px] font-bold text-primary">
              {Math.round(recommendation.score * 100)}%
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
              title="Clip created"
            >
              <Check className="h-3 w-3" />
            </div>
          ),
          selected && (
            <div
              key="selected"
              className="bg-primary text-primary-foreground rounded-full p-1 shadow-lg animate-in zoom-in-50 duration-300"
            >
              <Play className="h-3 w-3 fill-current" />
            </div>
          ),
        ].filter(Boolean) as React.ReactNode[]
      }
      overlayActions={
        [
          onCreateClip && (
            <Button
              key="create"
              size="icon"
              variant="default"
              className="h-8 w-8 rounded-full shadow-xl lg:translate-y-2 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 transition-all duration-300"
              onClick={(e) => {
                e.stopPropagation();
                onCreateClip(recommendation);
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ),
        ].filter(Boolean) as React.ReactNode[]
      }
      thumbnailHeight="h-32"
    />
  );
}
