'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardHeader, CardContent } from '@/components/ui/card';
import { Scissors, Sparkles, Captions } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaClipPanelProps {
  clipsContent: React.ReactNode;
  recommendationsContent: React.ReactNode;
  transcriptsContent: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  defaultTab?: string;
  clipCount?: number;
  transcriptCount?: number;
  recommendationCount?: number;
  transcriptsHeaderContent?: React.ReactNode;
  className?: string;
}

export function MediaClipPanel({
  clipsContent,
  recommendationsContent,
  transcriptsContent,
  activeTab,
  onTabChange,
  defaultTab = 'clips',
  clipCount: _clipCount,
  transcriptCount,
  recommendationCount,
  transcriptsHeaderContent,
  className,
}: MediaClipPanelProps) {
  const showRecommendationsTab = (recommendationCount ?? 0) > 0;
  return (
    <Tabs
      value={activeTab}
      defaultValue={activeTab ? undefined : defaultTab}
      onValueChange={onTabChange}
      className={cn('flex flex-col h-full', className)}
    >
      <CardHeader className="pb-3">
        <TabsList className="w-full">
          <TabsTrigger value="clips" className="flex-1 gap-1.5">
            <Scissors className="h-4 w-4" />
            Clips
          </TabsTrigger>
          {showRecommendationsTab && (
            <TabsTrigger value="recommendations" className="flex-1 gap-1.5">
              <Sparkles className="h-4 w-4" />
              Recs
            </TabsTrigger>
          )}
          <TabsTrigger value="transcripts" className="flex-1 gap-1.5">
            <Captions className="h-4 w-4" />
            Transcripts
          </TabsTrigger>
        </TabsList>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col overflow-hidden px-0 pt-0">
        <TabsContent
          value="clips"
          className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[400px] lg:max-h-none mt-0"
        >
          {clipsContent}
        </TabsContent>

        {showRecommendationsTab && (
          <TabsContent
            value="recommendations"
            className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[400px] lg:max-h-none mt-0"
          >
            {recommendationsContent}
          </TabsContent>
        )}

        <TabsContent
          value="transcripts"
          className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[400px] lg:max-h-none mt-0"
        >
          <div className="mb-3 flex items-center justify-between px-0">
            {transcriptCount !== undefined && (
              <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                {transcriptCount} found
              </span>
            )}
            {transcriptsHeaderContent}
          </div>
          {transcriptsContent}
        </TabsContent>
      </CardContent>
    </Tabs>
  );
}
