'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Media, MediaClip } from '@project/shared';
import { MediaClipMutator } from '@project/shared/mutator';
import {
  validateTimeRange,
  calculateDuration,
} from '@project/shared/utils/time';
import pb from '@/lib/pocketbase-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { TrimHandles } from '@/components/video/trim-handles';
import { useVideoSource } from '@/hooks/use-video-source';
import { Edit, AlertCircle, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface InlineClipEditorProps {
  media: Media;
  clip: MediaClip;
  onClipUpdated?: () => void;
  onCancel?: () => void;
  className?: string;
}

const MIN_CLIP_DURATION = 0.5; // seconds

export function InlineClipEditor({
  media,
  clip,
  onClipUpdated,
  onCancel,
  className,
}: InlineClipEditorProps) {
  const [startTime, setStartTime] = useState<number>(clip.start);
  const [endTime, setEndTime] = useState<number>(clip.end);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentVideoTime, setCurrentVideoTime] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { src, poster } = useVideoSource(media);

  // Validate time range whenever inputs change
  useEffect(() => {
    if (!validateTimeRange(startTime, endTime, media.duration)) {
      if (startTime < 0) {
        setValidationError('Start time cannot be negative');
      } else if (startTime >= endTime) {
        setValidationError('Start time must be less than end time');
      } else if (endTime > media.duration) {
        setValidationError(
          `End time cannot exceed media duration (${media.duration.toFixed(2)}s)`
        );
      } else {
        setValidationError('Invalid time range');
      }
      return;
    }

    const duration = calculateDuration(startTime, endTime);
    if (duration < MIN_CLIP_DURATION) {
      setValidationError(`Clip must be at least ${MIN_CLIP_DURATION} seconds`);
      return;
    }

    setValidationError(null);
  }, [startTime, endTime, media.duration]);

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

  const handleTrimChange = useCallback((start: number, end: number) => {
    setStartTime(start);
    setEndTime(end);
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

  const handleSaveClip = useCallback(async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);

    try {
      const mutator = new MediaClipMutator(pb);
      const duration = calculateDuration(startTime, endTime);

      await mutator.update(clip.id, {
        start: startTime,
        end: endTime,
        duration,
      });

      toast.success('Clip updated successfully');
      onClipUpdated?.();
    } catch (error) {
      console.error('Failed to update clip:', error);
      toast.error('Failed to update clip');
    } finally {
      setIsSaving(false);
    }
  }, [clip.id, startTime, endTime, validationError, onClipUpdated]);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const duration = calculateDuration(startTime, endTime);
  const hasChanges = startTime !== clip.start || endTime !== clip.end;

  return (
    <div className={cn('space-y-3 sm:space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between min-h-[2.5rem] gap-2">
        <div className="flex items-center gap-2 text-sm font-medium min-w-0">
          <Edit className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">Editing Clip</span>
          {hasChanges && (
            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
              (unsaved changes)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
            className="hidden sm:flex"
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            disabled={isSaving}
            className="sm:hidden h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={handleSaveClip}
            disabled={!!validationError || isSaving || !hasChanges}
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                <span className="hidden sm:inline">Saving...</span>
              </>
            ) : (
              <>
                <Check className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Save</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Video Preview */}
      <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
        {src ? (
          <VideoPlayerUI
            src={src}
            poster={poster}
            startTime={startTime}
            endTime={endTime}
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
      <div className="space-y-2">
        <TrimHandles
          duration={media.duration}
          startTime={startTime}
          endTime={endTime}
          onChange={handleTrimChange}
          onScrub={handleScrub}
          currentTime={currentVideoTime}
          minDuration={MIN_CLIP_DURATION}
        />
        <p className="text-xs text-muted-foreground hidden sm:block">
          Drag the handles to adjust clip boundaries. Use arrow keys for
          fine-tuning (hold Shift for larger steps).
        </p>
        <p className="text-xs text-muted-foreground sm:hidden">
          Drag the handles to adjust clip boundaries.
        </p>
      </div>

      {/* Duration Display */}
      <div className="flex items-center justify-between p-2 sm:p-3 bg-muted rounded-lg">
        <span className="text-xs sm:text-sm font-medium">Clip Duration:</span>
        <span className="text-xs sm:text-sm font-mono">
          {duration > 0 ? formatTime(duration) : '0:00.00'}
        </span>
      </div>

      {/* Original vs New comparison */}
      {hasChanges && (
        <div className="p-2 sm:p-3 bg-muted/50 rounded-lg space-y-2 text-xs sm:text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Original:</span>
            <span className="font-mono text-right truncate">
              {formatTime(clip.start)} - {formatTime(clip.end)} (
              {formatTime(clip.duration)})
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground shrink-0">New:</span>
            <span className="font-mono text-primary text-right truncate">
              {formatTime(startTime)} - {formatTime(endTime)} (
              {formatTime(duration)})
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
  );
}
