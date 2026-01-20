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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { TrimHandles } from '@/components/video/trim-handles';
import { useVideoSource } from '@/hooks/use-video-source';
import {
  Scissors,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface ClipCreatorProps {
  media: Media;
  onClipCreated?: () => void;
  className?: string;
}

const MIN_CLIP_DURATION = 0.5; // seconds

export function ClipCreator({
  media,
  onClipCreated,
  className,
}: ClipCreatorProps) {
  const { currentWorkspace } = useWorkspace();
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(media.duration);
  const [isCreating, setIsCreating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentVideoTime, setCurrentVideoTime] = useState<number>(0);
  const [showPreciseInputs, setShowPreciseInputs] = useState(false);
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

  const handleSetCurrentAsStart = useCallback(() => {
    if (videoRef.current) {
      setStartTime(videoRef.current.currentTime);
    }
  }, []);

  const handleSetCurrentAsEnd = useCallback(() => {
    if (videoRef.current) {
      setEndTime(videoRef.current.currentTime);
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
        type: ClipType.RANGE,
        start: startTime,
        end: endTime,
        duration,
        version: 1,
      });

      toast.success('Clip created successfully');

      // Reset form
      setStartTime(0);
      setEndTime(media.duration);

      // Notify parent
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

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scissors className="h-5 w-5" />
          Create Clip
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <Label>Trim Range</Label>
          <TrimHandles
            duration={media.duration}
            startTime={startTime}
            endTime={endTime}
            onChange={handleTrimChange}
            onScrub={handleScrub}
            currentTime={currentVideoTime}
            minDuration={MIN_CLIP_DURATION}
          />
          <p className="text-xs text-muted-foreground">
            Drag the handles to set clip boundaries, or use arrow keys for
            fine-tuning
          </p>
        </div>

        {/* Precise Time Inputs (Collapsible) */}
        <Collapsible
          open={showPreciseInputs}
          onOpenChange={setShowPreciseInputs}
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
            >
              <span>Precise Time Adjustment</span>
              {showPreciseInputs ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time (seconds)</Label>
                <div className="flex gap-2">
                  <Input
                    id="start-time"
                    type="number"
                    step="0.01"
                    min="0"
                    max={media.duration}
                    value={startTime.toFixed(2)}
                    onChange={(e) =>
                      setStartTime(parseFloat(e.target.value) || 0)
                    }
                    placeholder="0.00"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSetCurrentAsStart}
                  >
                    Set Current
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatTime(startTime)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-time">End Time (seconds)</Label>
                <div className="flex gap-2">
                  <Input
                    id="end-time"
                    type="number"
                    step="0.01"
                    min="0"
                    max={media.duration}
                    value={endTime.toFixed(2)}
                    onChange={(e) =>
                      setEndTime(parseFloat(e.target.value) || 0)
                    }
                    placeholder={media.duration.toString()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSetCurrentAsEnd}
                  >
                    Set Current
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatTime(endTime)}
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Duration Display */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">Clip Duration:</span>
          <span className="text-sm font-mono">
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

        {/* Create Button */}
        <Button
          onClick={handleCreateClip}
          disabled={!!validationError || isCreating}
          className="w-full"
        >
          {isCreating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              Creating...
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Create Clip
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
