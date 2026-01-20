'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RecommendationStrategy } from '@project/shared';
import { useTimelineRecommendations } from '@/hooks/use-timeline-recommendations';

interface TimelineRecommendationsSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TimelineRecommendationsSettingsModal({
  open,
  onOpenChange,
}: TimelineRecommendationsSettingsModalProps) {
  const {
    selectedStrategies,
    filterByStrategy,
    toggleExcludeAccepted,
    toggleExcludeDismissed,
    excludeAccepted,
    excludeDismissed,
  } = useTimelineRecommendations();

  // Strategy display mapping
  const strategyDisplay: Record<
    RecommendationStrategy,
    { label: string; description: string }
  > = {
    [RecommendationStrategy.SAME_ENTITY]: {
      label: 'Same Entity',
      description: 'Finds clips containing the same people or objects.',
    },
    [RecommendationStrategy.ADJACENT_SHOT]: {
      label: 'Adjacent Shot',
      description:
        'Suggests shots that are chronologically next to the current clip.',
    },
    [RecommendationStrategy.TEMPORAL_NEARBY]: {
      label: 'Nearby',
      description: 'Clips from the same time period.',
    },
    [RecommendationStrategy.CONFIDENCE_DURATION]: {
      label: 'High Confidence',
      description: 'High quality clips with clear subjects.',
    },
    [RecommendationStrategy.DIALOG_CLUSTER]: {
      label: 'Dialog Cluster',
      description: 'Related speech or dialog segments.',
    },
    [RecommendationStrategy.OBJECT_POSITION_MATCHER]: {
      label: 'Object Position',
      description: 'Matches visual composition and object placement.',
    },
    [RecommendationStrategy.ACTIVITY_STRATEGY]: {
      label: 'Activity',
      description: 'Similar actions or activities.',
    },
  };

  const strategies = Object.values(
    RecommendationStrategy
  ) as RecommendationStrategy[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Recommendation Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <h4 className="font-medium leading-none">General Filters</h4>
            <div className="flex items-center justify-between space-x-2">
              <Label
                htmlFor="exclude-accepted"
                className="flex flex-col space-y-1"
              >
                <span>Hide Accepted</span>
                <span className="font-normal text-xs text-muted-foreground">
                  Don&apos;t show recommendations you&apos;ve already added
                </span>
              </Label>
              <Switch
                id="exclude-accepted"
                checked={excludeAccepted}
                onCheckedChange={toggleExcludeAccepted}
              />
            </div>
            <div className="flex items-center justify-between space-x-2">
              <Label
                htmlFor="exclude-dismissed"
                className="flex flex-col space-y-1"
              >
                <span>Hide Dismissed</span>
                <span className="font-normal text-xs text-muted-foreground">
                  Don&apos;t show recommendations you&apos;ve dismissed
                </span>
              </Label>
              <Switch
                id="exclude-dismissed"
                checked={excludeDismissed}
                onCheckedChange={toggleExcludeDismissed}
              />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium leading-none">Active Strategies</h4>
            <p className="text-sm text-muted-foreground">
              Select which strategies to use for generating recommendations. If
              none are selected, all strategies are used.
            </p>
            <div className="grid gap-4">
              {strategies.map((strategy) => (
                <div
                  key={strategy}
                  className="flex items-start justify-between space-x-2"
                >
                  <Label
                    htmlFor={`strategy-${strategy}`}
                    className="flex flex-col space-y-1"
                  >
                    <span>{strategyDisplay[strategy]?.label || strategy}</span>
                    <span className="font-normal text-xs text-muted-foreground">
                      {strategyDisplay[strategy]?.description}
                    </span>
                  </Label>
                  <Switch
                    id={`strategy-${strategy}`}
                    checked={
                      selectedStrategies.length === 0 ||
                      selectedStrategies.includes(strategy)
                    }
                    onCheckedChange={() => filterByStrategy(strategy)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
