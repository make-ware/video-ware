'use client';

import React, { useState } from 'react';
import type { MediaClip, Media } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Eye } from 'lucide-react';
import { MediaBaseCard } from '@/components/media/media-base-card';
import { TimelineClipDetailsDialog } from '@/components/timeline/timeline-clip-details-dialog';

/**
 * Extended MediaClip type with expanded relations
 */
export interface MediaClipWithExpand extends Omit<MediaClip, 'expand'> {
  expand?: {
    MediaRef?: Media & {
      expand?: {
        UploadRef?: {
          filename: string;
          name?: string;
        };
        thumbnailFileRef?: {
          id: string;
          collectionId: string;
          file: string;
        };
        spriteFileRef?: any;
        filmstripFileRefs?: any[];
      };
    };
  };
}

// Card dimensions
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 160;

interface ClipBrowserItemProps {
  clip: MediaClipWithExpand;
  onAddToTimeline: (clip: MediaClipWithExpand) => void;
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

  const mediaName = upload?.filename || upload?.name || 'Unknown Media';

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDetailsOpen(true);
  };

  // Construct a pseudo-clip for the dialog
  const detailsClip: any = {
    id: clip.id,
    start: clip.start,
    end: clip.end,
    order: 0,
    meta: {},
    expand: {
      MediaRef: media,
      MediaClipRef: clip,
    },
  };

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
      <TimelineClipDetailsDialog
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        clip={detailsClip}
      />
    </>
  );
}
