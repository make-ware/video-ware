'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Eye } from 'lucide-react';
import { MediaBaseCard } from '@/components/media/media-base-card';
import { TimelineClipDetailsDialog } from '@/components/timeline/timeline-clip-details-dialog';
import {
  ExpandedMediaClip,
  ExpandedTimelineClip,
} from '@/types/expanded-types';

// Card dimensions
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 160;

interface ClipBrowserItemProps {
  clip: ExpandedMediaClip;
  onAddToTimeline: (clip: ExpandedMediaClip) => void;
}

export function ClipBrowserItem({
  clip,
  onAddToTimeline,
}: ClipBrowserItemProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const media = clip.expand?.MediaRef;
  const upload = media?.expand?.UploadRef;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const mediaName = upload?.name || 'Unknown Media';

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDetailsOpen(true);
  };

  // Construct a pseudo-clip for the dialog
  const detailsClip: ExpandedTimelineClip | null = media
    ? {
        id: clip.id,
        TimelineRef: 'preview',
        MediaRef: media.id,
        MediaClipRef: clip.id,
        start: clip.start,
        end: clip.end,
        duration: clip.end - clip.start,
        collectionId: '',
        collectionName: '',
        order: 0,
        meta: {},
        created: clip.created,
        updated: clip.updated,
        expand: {
          MediaRef: media,
          MediaClipRef: clip,
        },
      }
    : null;

  return (
    <>
      <MediaBaseCard
        media={media}
        spriteFile={media?.expand?.spriteFileRef}
        startTime={clip.start}
        endTime={clip.end}
        title={
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <Badge
              variant="outline"
              className="uppercase text-[10px] font-semibold h-5 px-2"
            >
              {clip.type}
            </Badge>
          </div>
        }
        subtitle={
          <div className="mt-1 flex flex-col gap-1">
            <div className="text-[10px] font-medium truncate opacity-60">
              {mediaName}
            </div>
            {/* Time & Date Info */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center justify-between gap-1">
                <span className="opacity-70">In:</span>
                {formatTime(clip.start)}
              </span>
              <span className="flex items-center justify-between gap-1">
                <span className="opacity-70">Out:</span>
                {formatTime(clip.end)}
              </span>
            </div>
          </div>
        }
        badges={[
          <div
            key="duration"
            className="bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold"
          >
            {formatTime(clip.end - clip.start)}
          </div>,
        ]}
        overlayActions={[
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
          <Button
            key="add"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onAddToTimeline(clip);
            }}
            className="h-7 w-7 shadow-md"
            title="Add to Timeline"
          >
            <Plus className="h-4 w-4" />
          </Button>,
        ]}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/json',
            JSON.stringify({
              type: 'media-clip',
              clipId: clip.id,
              mediaId: clip.MediaRef,
              start: clip.start,
              end: clip.end,
              clipType: clip.type,
            })
          );
          e.dataTransfer.effectAllowed = 'copy';
        }}
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
