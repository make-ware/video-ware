'use client';

import React from 'react';
import { useTimeline } from '@/hooks/use-timeline';

import { LayerTimelineView } from './layer-timeline-view';
import { SequenceTimelineView } from './sequence-timeline-view';

export function TimelineView() {
  const { timeline, duration, currentTime } = useTimeline();

  if (!timeline) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-4 w-full h-full overflow-hidden">
      {/* Layer View Section */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
            Scrubber & Layers
            <span className="w-1 h-1 rounded-full bg-primary/40" />
            <span className="font-mono text-primary/80 lowercase">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </span>
        </div>
        <LayerTimelineView />
      </div>

      {/* Sequence View Section */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-0">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
            Clip Sequence
            <span className="w-1 h-1 rounded-full bg-primary/40" />
            <span className="lowercase">
              {timeline.clips.length} draggable blocks
            </span>
          </span>
        </div>
        <SequenceTimelineView />
      </div>
    </div>
  );
}
