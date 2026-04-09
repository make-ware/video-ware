'use client';

import React, { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Edit, X, Clock, Layers, Info, Tag, FileVideo } from 'lucide-react';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { useVideoSource } from '@/hooks/use-video-source';
import { ClipType } from '@project/shared';
import { calculateMediaDate, formatMediaDateTime } from '@/utils/date-utils';
import {
  ExpandedMedia,
  ExpandedMediaClip,
  ExpandedTimelineClip,
} from '@/types/expanded-types';
import { formatClipTime } from '@/utils/format-clip-time';

type ClipUnion = (ExpandedMediaClip | ExpandedTimelineClip) & {
  type: string;
  start: number;
  end: number;
  duration: number;
  id: string;
  clipData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

interface ClipBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: ClipUnion;
  onEdit?: () => void;
  onClipUpdated?: () => void;
  /** @deprecated Use ClipEditorModal instead. Kept for backward compatibility. */
  initialMode?: 'view' | 'edit';
  /** @deprecated Use ClipEditorModal instead. */
  onSave?: (updates: Record<string, unknown>) => Promise<void>;
}

export function ClipBaseDialog({
  open,
  onOpenChange,
  clip,
  onEdit,
  initialMode: _initialMode,
  onSave: _onSave,
  onClipUpdated: _onClipUpdated,
}: ClipBaseDialogProps) {
  const media = clip.expand?.MediaRef as ExpandedMedia | undefined;
  const isComposite = useMemo(() => {
    const segments =
      (clip.clipData as { segments?: unknown[] } | undefined)?.segments ||
      (clip.meta as { segments?: unknown[] } | undefined)?.segments;
    return (
      !!(segments && (segments as unknown[]).length > 0) ||
      clip.type === ClipType.COMPOSITE
    );
  }, [clip]);

  const { src, poster } = useVideoSource(media ?? undefined);

  const metadata = useMemo(() => {
    return clip.clipData || clip.meta || {};
  }, [clip]);

  const isEditable = useMemo(() => {
    return (
      clip.type === ClipType.USER ||
      clip.type === ClipType.COMPOSITE ||
      clip.type === ClipType.RANGE
    );
  }, [clip.type]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> Clip Details
            </DialogTitle>
            <div className="flex items-center gap-2">
              {isEditable && onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onEdit();
                  }}
                >
                  <Edit className="h-4 w-4 mr-1" /> Edit
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[85vh]">
          <div className="space-y-6 p-1">
            {/* Video Preview */}
            <div className="aspect-video bg-black rounded-lg overflow-hidden relative border shadow-sm">
              {src ? (
                <VideoPlayerUI
                  src={src}
                  poster={poster}
                  startTime={clip.start}
                  endTime={clip.end}
                  className="w-full h-full"
                  autoPlay
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No preview available
                </div>
              )}
              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono">
                {formatClipTime(clip.start)} - {formatClipTime(clip.end)}
              </div>
            </div>

            {/* Timing & Source Info */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  {isComposite ? (
                    <Layers className="h-4 w-4" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}{' '}
                  Timing
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Start:</div>
                  <div className="font-mono text-right">
                    {formatClipTime(clip.start)}
                  </div>
                  <div className="text-muted-foreground">End:</div>
                  <div className="font-mono text-right">
                    {formatClipTime(clip.end)}
                  </div>
                  <div className="text-muted-foreground font-medium">
                    Duration:
                  </div>
                  <div className="font-mono text-right font-medium">
                    {isComposite
                      ? formatClipTime(clip.duration)
                      : formatClipTime(clip.end - clip.start)}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileVideo className="h-4 w-4" /> Source Media
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[auto,1fr] gap-2">
                    <span className="text-muted-foreground">Date:</span>
                    <span className="font-medium text-foreground">
                      {media
                        ? formatMediaDateTime(
                            calculateMediaDate(media.mediaDate, clip.start)
                          )
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="grid grid-cols-[auto,1fr] gap-2">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="capitalize">
                      {media?.mediaType || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Metadata */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4" /> Metadata
              </h4>
              <div className="space-y-2">
                {Object.keys(metadata).length > 0 ? (
                  <div className="bg-muted/50 p-3 rounded-md text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(metadata, null, 2)}
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
