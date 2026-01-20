'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Media } from '@project/shared';
import { MediaClipMutator } from '@project/shared/mutator';
import { ClipType } from '@project/shared/enums';
import {
  validateTimeRange,
  calculateDuration,
} from '@project/shared/utils/time';
import pb from '@/lib/pocketbase-client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { TrimHandles } from '@/components/video/trim-handles';
import { useVideoSource } from '@/hooks/use-video-source';
import { Scissors, AlertCircle, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface InlineClipCreatorProps {
  media: Media;
  onClipCreated?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function InlineClipCreator({
  media,
  onClipCreated,
  onCancel,
  className,
}: InlineClipCreatorProps) {
  const { currentWorkspace } = useWorkspace();
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(media.duration);
  const [isCreating, setIsCreating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentVideoTime, setCurrentVideoTime] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { src, poster } = useVideoSource(media);

  // Validate time range whenever inputs change (only critical validation, no minimum duration)
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

    // No minimum duration check - clips can be any length
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

  const handleCreateClip = useCallback(async () => {
    if (!currentWorkspace) {
      toast.error('No workspace selected');
      return;
    }

    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsCreating(true);

    try {
      const mutator = new MediaClipMutator(pb);
      const duration = calculateDuration(startTime, endTime);

      await mutator.create({
        WorkspaceRef: currentWorkspace?.id,
        MediaRef: media.id,
        type: ClipType.USER,
        start: startTime,
        end: endTime,
        duration,
        version: 1,
      });

      toast.success('Clip created successfully');
      onClipCreated?.();
    } catch (error) {
      console.error('Failed to create clip:', error);
      toast.error('Failed to create clip');
    } finally {
      setIsCreating(false);
    }
  }, [
    currentWorkspace,
    media,
    startTime,
    endTime,
    validationError,
    onClipCreated,
  ]);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const duration = calculateDuration(startTime, endTime);

  // Save button is enabled immediately when "create clip" is pressed
  // Only disabled if there's a validation error
  const canSave = !validationError;

  return (
    <div className={cn('space-y-3 sm:space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between min-h-[2.5rem] gap-2">
        <div className="flex items-center gap-2 text-sm font-medium min-w-0">
          <Scissors className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">Creating New Clip</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isCreating}
            className="hidden sm:flex"
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            disabled={isCreating}
            className="sm:hidden h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={handleCreateClip}
            disabled={!canSave || isCreating}
          >
            {isCreating ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                <span className="hidden sm:inline">Saving...</span>
              </>
            ) : (
              <>
                <Check className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Save Clip</span>
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
            autoPlay={false}
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
          minDuration={0}
        />
        <p className="text-xs text-muted-foreground hidden sm:block">
          Drag the handles to set clip boundaries. Use arrow keys for
          fine-tuning (hold Shift for larger steps).
        </p>
        <p className="text-xs text-muted-foreground sm:hidden">
          Drag the handles to set clip boundaries.
        </p>
      </div>

      {/* Duration Display */}
      <div className="flex items-center justify-between p-2 sm:p-3 bg-muted rounded-lg">
        <span className="text-xs sm:text-sm font-medium">Clip Duration:</span>
        <span className="text-xs sm:text-sm font-mono">
          {duration > 0 ? formatTime(duration) : '0:00.00'}
        </span>
      </div>

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
