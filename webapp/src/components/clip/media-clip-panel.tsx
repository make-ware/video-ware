'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardHeader, CardContent } from '@/components/ui/card';
import { Scissors, Captions } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaClipPanelProps {
  clipsContent: React.ReactNode;
  /**
   * Pinned above the clips scroll area (the filter/search/sort toolbar), so it
   * stays put while a long, paged clip list scrolls under it.
   */
  clipsHeaderContent?: React.ReactNode;
  transcriptsContent: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  defaultTab?: string;
  transcriptCount?: number;
  transcriptsHeaderContent?: React.ReactNode;
  className?: string;
}

export function MediaClipPanel({
  clipsContent,
  clipsHeaderContent,
  transcriptsContent,
  activeTab,
  onTabChange,
  defaultTab = 'clips',
  transcriptCount,
  transcriptsHeaderContent,
  className,
}: MediaClipPanelProps) {
  return (
    <Tabs
      value={activeTab}
      defaultValue={activeTab ? undefined : defaultTab}
      onValueChange={onTabChange}
      className={cn('flex flex-col h-full', className)}
    >
      <CardHeader className="pb-3 px-3 sm:px-6">
        <TabsList className="w-full">
          <TabsTrigger value="clips" className="flex-1 gap-1.5">
            <Scissors className="h-4 w-4" />
            Clips
          </TabsTrigger>
          <TabsTrigger value="transcripts" className="flex-1 gap-1.5">
            <Captions className="h-4 w-4" />
            Transcripts
          </TabsTrigger>
        </TabsList>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col overflow-hidden px-0 pt-0">
        {/* Below `lg` the panel is a section of a scrolling page rather than a
            full-height sidebar, so each tab gets a viewport-relative window —
            400px showed barely one clip card on a phone. */}
        <TabsContent
          value="clips"
          className="flex-1 flex flex-col overflow-hidden max-h-[70vh] lg:max-h-none mt-0"
        >
          {/* Full-bleed: LibraryToolbar brings its own padding + border-b, so
              it spans the card and reads as a real toolbar. */}
          {clipsHeaderContent && (
            <div className="flex-shrink-0">{clipsHeaderContent}</div>
          )}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 pt-3">
            {clipsContent}
          </div>
        </TabsContent>

        <TabsContent
          value="transcripts"
          className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[70vh] lg:max-h-none mt-0"
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
