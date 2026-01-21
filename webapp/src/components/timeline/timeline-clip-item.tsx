'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineClip, Media, File } from '@project/shared';
import { useTimeline } from '@/hooks/use-timeline';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Trash2,
  GripVertical,
  Clock,
  Edit,
  AlertCircle,
  Check,
  X,
  Eye,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { TrimHandles } from '@/components/video/trim-handles';
import { useVideoSource } from '@/hooks/use-video-source';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TimelineClipDetailsDialog } from './timeline-clip-details-dialog';
import { calculateMediaDate, formatMediaDate } from '@/utils/date-utils';

const MIN_CLIP_DURATION = 0.5; // seconds

/**
 * Extended TimelineClip type with expanded Media relation
 */
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
  const { removeClip, updateClipTimes } = useTimeline();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [editStart, setEditStart] = useState(clip.start);
  const [editEnd, setEditEnd] = useState(clip.end);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentVideoTime, setCurrentVideoTime] = useState<number>(0);
  const [previewTime, setPreviewTime] = useState(clip.start);
  const videoRef = useRef<HTMLVideoElement>(null);

  const duration = clip.end - clip.start;
  const media = clip.expand?.MediaRef;
  // Only use video source if we have valid media
  const { src, poster } = useVideoSource(
    media ||
      ({
        id: '',
        collectionId: '',
        collectionName: 'Media',
        created: '',
        updated: '',
        WorkspaceRef: '',
        UploadRef: '',
        mediaType: 'video' as const,
        duration: 0,
        width: 0,
        height: 0,
        aspectRatio: 1,
        mediaData: {},
      } as Media)
  );

  // Sync previewTime with clip.start whenever clip changes or stops hovering
  useEffect(() => {
    if (!isHovering) {
      setPreviewTime(clip.start);
    }
  }, [isHovering, clip.start]);

  // Handle preview animation on hover
  useEffect(() => {
    if (!isHovering) return;

    // Use a 1-second interval for filmstrip preview animation
    const interval = setInterval(() => {
      setPreviewTime((prev) => {
        const next = prev + 1;
        return next >= clip.end ? clip.start : next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isHovering, clip.start, clip.end]);

  // Validate time range whenever inputs change
  useEffect(() => {
    if (!media) {
      setValidationError('No media reference found');
      return;
    }

    if (editStart < 0) {
      setValidationError('Start time cannot be negative');
      return;
    }

    if (editStart >= editEnd) {
      setValidationError('Start time must be less than end time');
      return;
    }

    if (editEnd > media.duration) {
      setValidationError(
        `End time cannot exceed media duration (${media.duration.toFixed(2)}s)`
      );
      return;
    }

    const clipDuration = editEnd - editStart;
    if (clipDuration < MIN_CLIP_DURATION) {
      setValidationError(`Clip must be at least ${MIN_CLIP_DURATION} seconds`);
      return;
    }

    setValidationError(null);
  }, [editStart, editEnd, media]);

  // Track video current time for trim handles
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentVideoTime(video.currentTime);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, []);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
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
    setEditStart(clip.start);
    setEditEnd(clip.end);
    setValidationError(null);
    setIsEditDialogOpen(true);
  };

  const handleDetailsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDetailsDialogOpen(true);
    onViewDetails?.();
  };

  const handleTrimChange = useCallback((start: number, end: number) => {
    setEditStart(start);
    setEditEnd(end);
  }, []);

  const handleScrub = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = time;
    } catch {
      // no-op (seeking can fail if metadata isn't loaded yet)
    }
  }, []);

  const handleSetCurrentAsStart = useCallback(() => {
    if (videoRef.current) {
      setEditStart(videoRef.current.currentTime);
    }
  }, []);

  const handleSetCurrentAsEnd = useCallback(() => {
    if (videoRef.current) {
      setEditEnd(videoRef.current.currentTime);
    }
  }, []);

  const handleSaveEdit = async () => {
    if (validationError) {
      return;
    }

    setIsUpdating(true);
    try {
      await updateClipTimes(clip.id, editStart, editEnd);
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error('Failed to update clip times:', error);
      alert(
        error instanceof Error ? error.message : 'Failed to update clip times'
      );
    } finally {
      setIsUpdating(false);
    }
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
          'p-0 gap-0', // Remove default Card padding and gap
          isDragging && 'opacity-50 scale-95',
          isSelected && 'ring-2 ring-primary ring-offset-2',
          className
        )}
      >
        {/* Drag Handle */}
        <div className="absolute top-2 left-2 text-foreground/80 z-10">
          <GripVertical className="h-4 w-4 drop-shadow-md" />
        </div>

        {/* Action Buttons - Top Right */}
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

        {/* Sprite Preview / Thumbnail */}
        <div className="h-24 bg-muted overflow-hidden relative">
          {media ? (
            media.filmstripFileRefs && media.filmstripFileRefs.length > 0 ? (
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

          {/* Duration Badge */}
          <div className="absolute bottom-2 left-2 bg-primary/90 text-primary-foreground text-xs px-2 py-0.5 rounded font-medium shadow-md">
            {formatTime(duration)}
          </div>
        </div>

        {/* Clip Info */}
        <div className="p-2.5 space-y-1.5">
          <div className="text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium">In:</span>
              <span className="font-mono text-[11px]">
                {formatTime(clip.start)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium">Out:</span>
              <span className="font-mono text-[11px]">
                {formatTime(clip.end)}
              </span>
            </div>
            {/* Media Date */}
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

      <TimelineClipDetailsDialog
        open={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        clip={clip}
      />

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <Edit className="h-5 w-5 text-primary" />
                Edit Clip
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditDialogOpen(false)}
                  disabled={isUpdating}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={
                    !!validationError ||
                    isUpdating ||
                    (editStart === clip.start && editEnd === clip.end)
                  }
                >
                  {isUpdating ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Video Preview */}
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
              {src && media ? (
                <VideoPlayerUI
                  src={src}
                  poster={poster}
                  startTime={editStart}
                  endTime={editEnd}
                  autoPlay={false}
                  seekOnStartTimeChange={false}
                  preload="auto"
                  className="w-full h-full"
                  ref={videoRef}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No video source available
                </div>
              )}
            </div>

            {/* Visual Trim Handles */}
            {media && (
              <div className="space-y-2">
                <TrimHandles
                  duration={media.duration}
                  startTime={editStart}
                  endTime={editEnd}
                  onChange={handleTrimChange}
                  onScrub={handleScrub}
                  currentTime={currentVideoTime}
                  minDuration={MIN_CLIP_DURATION}
                />
                <p className="text-xs text-muted-foreground">
                  Drag the handles to adjust clip boundaries. Use arrow keys for
                  fine-tuning (hold Shift for larger steps).
                </p>
              </div>
            )}

            {/* Precise Inputs */}
            {media && (
              <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
                <div className="space-y-2">
                  <Label htmlFor="edit-start">Start Time</Label>
                  <div className="flex gap-2">
                    <Input
                      id="edit-start"
                      type="number"
                      step="0.01"
                      min="0"
                      max={media.duration}
                      value={editStart.toFixed(2)}
                      onChange={(e) =>
                        setEditStart(parseFloat(e.target.value) || 0)
                      }
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSetCurrentAsStart}
                      title="Set current video time as start"
                    >
                      Use Current
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatTime(editStart)}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-end">End Time</Label>
                  <div className="flex gap-2">
                    <Input
                      id="edit-end"
                      type="number"
                      step="0.01"
                      min="0"
                      max={media.duration}
                      value={editEnd.toFixed(2)}
                      onChange={(e) =>
                        setEditEnd(parseFloat(e.target.value) || 0)
                      }
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSetCurrentAsEnd}
                      title="Set current video time as end"
                    >
                      Use Current
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {formatTime(editEnd)}
                  </div>
                </div>
              </div>
            )}

            {/* Duration Display */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <span className="text-sm font-medium">Clip Duration:</span>
              <span className="text-sm font-mono">
                {formatTime(editEnd - editStart)}
              </span>
            </div>

            {/* Original vs New comparison */}
            {(editStart !== clip.start || editEnd !== clip.end) && (
              <div className="p-3 bg-muted/50 rounded-lg space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Original:</span>
                  <span className="font-mono">
                    {formatTime(clip.start)} - {formatTime(clip.end)} (
                    {formatTime(duration)})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">New:</span>
                  <span className="font-mono text-primary">
                    {formatTime(editStart)} - {formatTime(editEnd)} (
                    {formatTime(editEnd - editStart)})
                  </span>
                </div>
              </div>
            )}

            {/* Validation Error */}
            {validationError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
