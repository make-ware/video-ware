'use client';

import React from 'react';
import type { MediaClip, Media } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Plus } from 'lucide-react';

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

import { MediaBaseCard } from '@/components/media/media-base-card';

export function ClipBrowserItem({
  clip,
  onAddToTimeline,
}: ClipBrowserItemProps) {
  const duration = clip.end - clip.start;
  const media = clip.expand?.MediaRef;
  const upload = media?.expand?.UploadRef;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const mediaName = upload?.filename || upload?.name || 'Unknown Media';

  return (
    <MediaBaseCard
      media={media}
      spriteFile={media?.expand?.spriteFileRef}
      startTime={clip.start}
      endTime={clip.end}
      title={
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <span className="truncate flex-1 min-w-0" title={mediaName}>
            {mediaName}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0.5 h-auto flex-shrink-0 whitespace-nowrap leading-none"
          >
            {clip.type}
          </Badge>
        </div>
      }
      subtitle={
        <div className="flex items-center gap-1 min-w-0">
          <Clock className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">
            {formatTime(clip.start)} - {formatTime(clip.end)}
          </span>
        </div>
      }
      badges={[
        <div
          key="duration"
          className="bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded font-mono"
        >
          {formatTime(duration)}
        </div>,
      ]}
      overlayActions={[
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
  );
}
