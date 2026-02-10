import { useState } from 'react';
import type { Media, MediaClip } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaBaseCard } from '@/components/media/media-base-card';
import { ClipBaseDialog } from '@/components/clip/clip-base-dialog';
import { ExpandedTimelineClip } from '@/types/expanded-types';

interface MediaClipItemProps {
  clip: MediaClip;
  media: Media;
  isActive: boolean;
  onClick: () => void;
}

export function MediaClipItem({
  clip,
  media,
  isActive,
  onClick,
}: MediaClipItemProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDetailsOpen(true);
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const clipData = clip.clipData as Record<string, unknown> | undefined;
  const label =
    typeof clipData?.label === 'string' ? (clipData.label as string) : 'Clip';

  // Construct a pseudo-clip for the dialog
  const detailsClip: ExpandedTimelineClip = {
    id: clip.id,
    TimelineRef: 'preview',
    MediaRef: media.id,
    MediaClipRef: clip.id,
    start: clip.start,
    end: clip.end,
    duration: clip.duration,
    collectionId: '',
    collectionName: '',
    order: 0,
    meta: clip.clipData,
    created: clip.created,
    updated: clip.updated,
    expand: {
      MediaRef: media,
      MediaClipRef: clip,
    },
  };

  return (
    <>
      <MediaBaseCard
        media={media}
        startTime={clip.start}
        endTime={clip.end}
        onSelect={onClick}
        className={cn(isActive && 'border-primary shadow-md bg-primary/5')}
        title={
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <Badge
              variant="outline"
              className={cn(
                'uppercase text-[10px] font-semibold h-5 px-2',
                isActive && 'border-primary/50 bg-primary/10'
              )}
            >
              {clip.type}
            </Badge>
          </div>
        }
        subtitle={
          <div className="mt-1 flex flex-col gap-1">
            <div
              className={cn(
                'text-[10px] font-medium truncate opacity-80',
                isActive && 'text-primary'
              )}
            >
              {label}
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
        ]}
      />

      {isDetailsOpen && (
        <ClipBaseDialog
          open={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          clip={detailsClip as any}
          initialMode="view"
        />
      )}
    </>
  );
}
