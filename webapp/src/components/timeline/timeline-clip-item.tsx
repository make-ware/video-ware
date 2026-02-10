'use client';

import React, { useState, useMemo, useEffect } from 'react';
import type {
  TimelineClip,
  TimelineClipUpdate,
  Media,
  File,
} from '@project/shared';
import { useTimeline } from '@/hooks/use-timeline';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, GripVertical, Clock, Edit, Eye, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateMediaDate, formatMediaDate } from '@/utils/date-utils';
import { calculateEffectiveDuration, ClipType } from '@project/shared';
import { CompositeClipPreview } from './composite-clip-preview';
import { ClipBaseDialog } from '@/components/clip/clip-base-dialog';
import type { ExpandedTimelineClip } from '@/types/expanded-types';

interface TimelineClipWithExpand extends Omit<TimelineClip, 'expand'> {
  expand?: {
    MediaRef?: Media & {
      expand?: {
        spriteFileRef?: File;
      };
    };
  };
}

interface TimelineClipItemProps {
  clip: TimelineClipWithExpand;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  onViewDetails?: () => void;
  className?: string;
}

export function TimelineClipItem({
  clip,
  onDragStart,
  onDragEnd,
  isDragging,
  isSelected = false,
  onSelect,
  onViewDetails,
  className,
}: TimelineClipItemProps) {
  const { removeClip, updateClip } = useTimeline();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'view' | 'edit'>('view');
  const [isHovering, setIsHovering] = useState(false);
  const [previewTimeState, setPreviewTimeState] = useState(clip.start);

  // Sync preview state with props and hover state during render phase
  // to avoid cascading renders from useEffect.
  const [prevSync, setPrevSync] = useState({ start: clip.start, isHovering });
  if (prevSync.start !== clip.start || prevSync.isHovering !== isHovering) {
    setPrevSync({ start: clip.start, isHovering });
    setPreviewTimeState(clip.start);
  }

  // Check if clip is composite
  const isComposite = useMemo(() => {
    return !!(clip.meta?.segments && clip.meta.segments.length > 0);
  }, [clip.meta?.segments]);

  // Calculate effective duration
  const effectiveDuration = useMemo(() => {
    if (isComposite && clip.meta?.segments) {
      if (clip.duration > 0) return clip.duration;
      return calculateEffectiveDuration(
        clip.start,
        clip.end,
        clip.meta.segments
      );
    }
    return clip.duration || clip.end - clip.start;
  }, [isComposite, clip.duration, clip.start, clip.end, clip.meta]);

  const media = clip.expand?.MediaRef;

  // Derive previewTime: use state when hovering, clip.start when not hovering
  const previewTime = isHovering ? previewTimeState : clip.start;

  // Handle preview animation on hover
  useEffect(() => {
    if (!isHovering) return;

    const interval = setInterval(() => {
      setPreviewTimeState((prev) => {
        const next = prev + 1;
        return next >= clip.end ? clip.start : next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isHovering, clip.start, clip.end]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeClip(clip.id);
    } catch (error) {
      console.error('Failed to remove clip:', error);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogMode('edit');
    setIsDialogOpen(true);
  };

  const handleDetailsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogMode('view');
    setIsDialogOpen(true);
    onViewDetails?.();
  };

  const handleSave = async (updates: TimelineClipUpdate) => {
    await updateClip(clip.id, updates);
  };

  return (
    <>
      <Card
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onSelect}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        className={cn(
          'relative w-48 cursor-move transition-all overflow-hidden group',
          'p-0 gap-0',
          isDragging && 'opacity-50 scale-95',
          isSelected && 'ring-2 ring-primary ring-offset-2',
          className
        )}
      >
        <div className="absolute top-2 left-2 text-foreground/80 z-10">
          <GripVertical className="h-4 w-4 drop-shadow-md" />
        </div>

        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 shadow-md"
            onClick={handleDetailsClick}
            title="View Details"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 shadow-md"
            onClick={handleEditClick}
            title="Edit Clip"
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="h-7 w-7 shadow-md"
            onClick={handleRemove}
            title="Remove Clip"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="h-24 bg-muted overflow-hidden relative">
          {media ? (
            isComposite && !isSelected && clip.meta?.segments ? (
              <CompositeClipPreview
                media={media}
                segments={clip.meta.segments}
                isHovering={isHovering}
                className="w-full h-full"
              />
            ) : media.filmstripFileRefs &&
              media.filmstripFileRefs.length > 0 ? (
              <FilmstripViewer
                media={media}
                currentTime={previewTime}
                className="w-full h-full"
              />
            ) : (
              <SpriteAnimator
                media={media}
                spriteFile={media.expand?.spriteFileRef}
                start={clip.start}
                end={clip.end}
                isHovering={isHovering}
                className="w-full h-full"
                fallbackIcon={
                  <div className="text-center text-xs text-muted-foreground">
                    <Clock className="h-6 w-6 mx-auto mb-1" />
                    <div>Clip {clip.order + 1}</div>
                  </div>
                }
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-xs text-muted-foreground">
                <Clock className="h-6 w-6 mx-auto mb-1" />
                <div>Clip {clip.order + 1}</div>
              </div>
            </div>
          )}

          <div className="absolute bottom-2 left-2 bg-primary/90 text-primary-foreground text-xs px-2 py-0.5 rounded font-medium shadow-md">
            {formatTime(effectiveDuration)}
          </div>
        </div>

        <div className="p-2.5 space-y-1.5">
          <div className="text-xs space-y-1">
            {isComposite ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">
                  Segments:
                </span>
                <span className="font-mono text-[11px]">
                  {clip.meta?.segments?.length || 0}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">In:</span>
                  <span className="font-mono text-[11px]">
                    {formatTime(clip.start)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">
                    Out:
                  </span>
                  <span className="font-mono text-[11px]">
                    {formatTime(clip.end)}
                  </span>
                </div>
              </>
            )}

            <div className="flex items-center justify-between border-t pt-1 mt-1">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Date:
              </span>
              <span className="font-mono text-[11px]">
                {formatMediaDate(
                  calculateMediaDate(media?.mediaDate, clip.start)
                )}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <ClipBaseDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        clip={
          {
            ...clip,
            type: isComposite ? ClipType.COMPOSITE : ClipType.USER,
          } as ExpandedTimelineClip & { type: string }
        }
        initialMode={dialogMode}
        onSave={handleSave}
      />
    </>
  );
}
