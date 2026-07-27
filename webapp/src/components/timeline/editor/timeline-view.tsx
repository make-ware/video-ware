'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useTimeline } from '@/hooks/use-timeline';

import { LayerTimelineView } from './layer-timeline-view';
import { SelectedClipView } from './selected-clip-view';

export function TimelineView() {
  const { timeline, duration, currentTime, tracks, selectedClipIds } =
    useTimeline();

  if (!timeline) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const trackCount = tracks.length;

  return (
    <div className="flex flex-col gap-1 lg:gap-4 w-full h-full overflow-hidden">
      {/* Layer View Section. flex-1, not shrink-0: content-sized layers used to
          squeeze the selected-clip section to zero past ~4 tracks inside this
          fixed-height, overflow-hidden pane, with nothing able to scroll. */}
      <div className="flex flex-col gap-1 flex-1 min-h-0">
        {/* ~18px of a phone's pane to label a section that is self-evident;
            the clock moves to the player's transport row below sm. */}
        <div className="hidden sm:flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
            Scrubber & Layers
            <span className="w-1 h-1 rounded-full bg-primary/40" />
            <span className="font-mono text-primary/80 lowercase">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <span className="w-1 h-1 rounded-full bg-primary/40" />
            <span className="lowercase">
              {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
            </span>
          </span>
        </div>
        <LayerTimelineView />
      </div>

      {/* Selected Clip Section. On a phone its 192px empty state cost a third
          of the timeline pane to say "select a clip", so it only takes space
          once there is something to inspect. */}
      <div
        className={cn(
          'flex flex-col gap-1.5 shrink-0',
          selectedClipIds.size === 0 && 'hidden sm:flex'
        )}
      >
        <div className="hidden sm:flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
            Selected Clip
            {selectedClipIds.size > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-primary/40" />
                <span className="lowercase">
                  {selectedClipIds.size} selected
                </span>
              </>
            )}
          </span>
        </div>
        <SelectedClipView />
      </div>
    </div>
  );
}
