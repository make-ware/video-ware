'use client';

import { useState } from 'react';
import { TimelineRecommendation } from '@project/shared';
import { TimelineRecommendationCard } from './timeline-recommendation-card';
import { TimelineRecommendationsSettingsModal } from './timeline-recommendations-settings-modal';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CLIP_GRID_CLASS } from '@/components/timeline/constants';

interface TimelineRecommendationsPanelProps {
  recommendations: TimelineRecommendation[];
  selectedClipRecommendations?: TimelineRecommendation[];
  isLoading?: boolean;
  onAdd?: (recommendation: TimelineRecommendation) => void;
  onReplace?: (recommendation: TimelineRecommendation) => void;
  onDismiss?: (recommendation: TimelineRecommendation) => void;
  onMoreLikeThis?: () => void;
  className?: string;
}

/**
 * TimelineRecommendationsPanel Component
 *
 * Displays a panel of timeline recommendations with:
 * - "Recommendations" header
 * - List of TimelineRecommendationCards
 * - "More like this" button to trigger regeneration
 * - Empty state when no recommendations available
 *
 * Requirements: 11.1, 11.6
 */
export function TimelineRecommendationsPanel({
  recommendations,
  selectedClipRecommendations,
  isLoading = false,
  onAdd,
  onReplace,
  onDismiss,
  onMoreLikeThis,
  className,
}: TimelineRecommendationsPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const hasAnyRecommendations =
    (recommendations && recommendations.length > 0) ||
    (selectedClipRecommendations && selectedClipRecommendations.length > 0);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <TimelineRecommendationsSettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMoreLikeThis}
            disabled={isLoading || !onMoreLikeThis}
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
            title="Refresh recommendations"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommendations</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSettingsOpen(true)}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        /* Loading skeleton */
        <div className={CLIP_GRID_CLASS}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-40 bg-muted/50 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : !hasAnyRecommendations ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-border rounded-lg bg-muted/20">
          <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-base font-medium text-foreground mb-2">
            No recommendations available
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Select a clip in your timeline or click refresh to get intelligent
            suggestions for what to add next.
          </p>
          {onMoreLikeThis && (
            <Button
              variant="outline"
              size="sm"
              onClick={onMoreLikeThis}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6 pb-8">
          {/* Timeline Recommendations (Primary) */}
          {recommendations && recommendations.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Up Next
              </h3>
              <div className={CLIP_GRID_CLASS}>
                {recommendations.map((recommendation) => (
                  <TimelineRecommendationCard
                    key={recommendation.id}
                    recommendation={recommendation}
                    onAdd={onAdd}
                    onReplace={onReplace}
                    onDismiss={onDismiss}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Selected Clip Recommendations (Secondary) */}
          {selectedClipRecommendations &&
            selectedClipRecommendations.length > 0 && (
              <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="h-3 w-3" />
                  For Selected Clip
                </h3>
                <div className={CLIP_GRID_CLASS}>
                  {selectedClipRecommendations.map((recommendation) => (
                    <TimelineRecommendationCard
                      key={recommendation.id}
                      recommendation={recommendation}
                      onAdd={onAdd}
                      onReplace={onReplace}
                      onDismiss={onDismiss}
                    />
                  ))}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
