'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Info, X, Clock, Tag, FileVideo } from 'lucide-react';
import type { TimelineClip, Media, MediaClip, File } from '@project/shared';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { calculateMediaDate, formatMediaDateTime } from '@/utils/date-utils';

interface DetailedTimelineClip extends Omit<TimelineClip, 'expand'> {
  expand?: {
    MediaRef?: Media & {
      expand?: {
        spriteFileRef?: File;
      };
    };
    MediaClipRef?: MediaClip;
  };
}

interface TimelineClipDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: DetailedTimelineClip;
}

export function TimelineClipDetailsDialog({
  open,
  onOpenChange,
  clip,
}: TimelineClipDetailsDialogProps) {
  const media = clip.expand?.MediaRef;
  const [previewTime, setPreviewTime] = useState(clip.start);

  // Auto-play preview
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setPreviewTime((prev) => {
        const next = prev + 1;
        return next >= clip.end ? clip.start : next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [open, clip.start, clip.end]);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              Clip Details
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[80vh]">
          <div className="space-y-6 p-1">
            {/* Visual Preview */}
            <div className="aspect-video bg-muted rounded-lg overflow-hidden relative shadow-sm border">
              {media ? (
                media.filmstripFileRefs &&
                media.filmstripFileRefs.length > 0 ? (
                  <FilmstripViewer
                    media={media}
                    currentTime={previewTime}
                    className="w-full h-full"
                  />
                ) : (
                  <SpriteAnimator
                    media={media}
                    spriteFile={(media as any).expand?.spriteFileRef}
                    start={clip.start}
                    end={clip.end}
                    isHovering={true}
                    className="w-full h-full"
                  />
                )
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No preview available
                </div>
              )}
              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono">
                {formatTime(previewTime)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Time Info */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Timing
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Start:</div>
                  <div className="font-mono text-right">
                    {formatTime(clip.start)}
                  </div>
                  <div className="text-muted-foreground">End:</div>
                  <div className="font-mono text-right">
                    {formatTime(clip.end)}
                  </div>
                  <div className="text-muted-foreground font-medium">
                    Duration:
                  </div>
                  <div className="font-mono text-right font-medium">
                    {formatTime(clip.end - clip.start)}
                  </div>
                </div>
              </div>

              {/* Media Info */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileVideo className="h-4 w-4" /> Source Media
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[auto,1fr] gap-2">
                    <span className="text-muted-foreground">Date:</span>
                    <span className="font-medium text-foreground">
                      {formatMediaDateTime(
                        calculateMediaDate(media?.mediaDate, clip.start)
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-[auto,1fr] gap-2">
                    <span className="text-muted-foreground">Created:</span>
                    <span>
                      {formatMediaDateTime(
                        media?.created ? new Date(media.created) : null
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-[auto,1fr] gap-2">
                    <span className="text-muted-foreground">Updated:</span>
                    <span>
                      {formatMediaDateTime(
                        media?.updated ? new Date(media.updated) : null
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Additional Info / Recommendation / Labels */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4" /> Metadata
              </h4>

              {/* Check for any labels or recommendation info in meta or mediaClip */}
              <div className="space-y-2">
                {clip.meta && Object.keys(clip.meta).length > 0 ? (
                  <div className="bg-muted/50 p-3 rounded-md text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(clip.meta, null, 2)}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No additional metadata available.
                  </p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
