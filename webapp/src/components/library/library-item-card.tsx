'use client';

import React, { useState } from 'react';
import type { Media, MediaClip, Timeline } from '@project/shared';
import { ClipType } from '@project/shared/enums';
import { MediaClipMutator, TimelineMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Edit, Trash2, X, Plus, ListVideo, Scissors, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MediaBaseCard } from '@/components/media/media-base-card';
import { ClipBaseDialog } from '@/components/clip/clip-base-dialog';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineService } from '@/services/timeline';
import type {
  ExpandedMedia,
  ExpandedMediaClip,
  ExpandedTimelineClip,
} from '@/types/expanded-types';
import type { MediaWithPreviews } from '@/services/media';
import type {
  LibraryItem,
  LibrarySurface,
  MediaClipDragPayload,
  MediaFullDragPayload,
} from './types';

const formatTime = (seconds: number): string => {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const formatTimeMs = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

interface LibraryItemCardProps {
  item: LibraryItem;
  surface: LibrarySurface;
  isActive?: boolean;
  onSelect?: (item: LibraryItem) => void;
  // Clip actions
  onClipUpdate?: () => void;
  onClipDelete?: () => void;
  onInlineEditClip?: (clipId: string) => void;
  onAddClipToTimeline?: (clip: ExpandedMediaClip | MediaClip) => void;
  // Media actions (timeline surface only)
  onAddMediaToTimeline?: (media: ExpandedMedia | MediaWithPreviews) => void;
  onCarveClipFromMedia?: (media: ExpandedMedia | MediaWithPreviews) => void;
  className?: string;
}

export function LibraryItemCard(props: LibraryItemCardProps) {
  if (props.item.kind === 'clip') {
    return <ClipCard {...props} item={props.item} />;
  }
  return <MediaCard {...props} item={props.item} />;
}

// ---------- Clip card ----------

interface ClipCardProps extends LibraryItemCardProps {
  item: { kind: 'clip'; id: string; clip: ExpandedMediaClip };
}

function ClipCard({
  item,
  surface,
  isActive = false,
  onSelect,
  onClipUpdate,
  onClipDelete,
  onInlineEditClip,
  onAddClipToTimeline,
  className,
}: ClipCardProps) {
  const clip = item.clip;
  const media = clip.expand?.MediaRef;
  const { currentWorkspace } = useWorkspace();

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'view' | 'edit'>('view');
  const [isDeleting, setIsDeleting] = useState(false);

  // Media-details-only: workspace-wide "add to timeline" dialog
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const clipData = (clip.clipData as Record<string, unknown>) || {};
  const label = typeof clipData.label === 'string' ? clipData.label : 'Clip';
  const mediaName = media?.expand?.UploadRef?.name || 'Unknown Media';

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogMode('view');
    setIsDetailsOpen(true);
  };

  const handleOpenEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogMode('edit');
    setIsDetailsOpen(true);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const mutator = new MediaClipMutator(pb);
      await mutator.delete(clip.id);
      toast.success('Clip deleted successfully');
      onClipDelete?.();
    } catch (error) {
      console.error('Failed to delete clip:', error);
      toast.error('Failed to delete clip');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenAddDialog = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentWorkspace) {
      toast.error('No workspace selected');
      return;
    }
    setIsAddDialogOpen(true);
    try {
      const timelineMutator = new TimelineMutator(pb);
      const result = await timelineMutator.getByWorkspace(currentWorkspace.id);
      setTimelines(result.items);
    } catch (error) {
      console.error('Failed to load timelines:', error);
      toast.error('Failed to load timelines');
    }
  };

  const handleSubmitAddToTimeline = async () => {
    if (!selectedTimelineId) {
      toast.error('Please select a timeline');
      return;
    }
    if (!media) {
      toast.error('Media not available');
      return;
    }
    setIsAdding(true);
    try {
      const timelineService = new TimelineService(pb);
      await timelineService.addClipToTimeline(
        selectedTimelineId,
        media.id,
        clip.start,
        clip.end,
        clip.id
      );
      toast.success('Clip added to timeline');
      setIsAddDialogOpen(false);
      setSelectedTimelineId('');
    } catch (error) {
      console.error('Failed to add clip to timeline:', error);
      toast.error('Failed to add clip to timeline');
    } finally {
      setIsAdding(false);
    }
  };

  const dragPayload: MediaClipDragPayload = {
    type: 'media-clip',
    clipId: clip.id,
    mediaId: clip.MediaRef,
    start: clip.start,
    end: clip.end,
    clipType: clip.type,
  };

  // Pseudo-clip for view-details dialog when expanded clip only has MediaRef
  const detailsClip: ExpandedTimelineClip | null = media
    ? {
        id: clip.id,
        TimelineRef: 'preview',
        MediaRef: media.id,
        MediaClipRef: clip.id,
        start: clip.start,
        end: clip.end,
        duration: clip.end - clip.start,
        collectionId: '',
        collectionName: '',
        order: 0,
        meta: {},
        created: clip.created,
        updated: clip.updated,
        expand: { MediaRef: media, MediaClipRef: clip },
      }
    : null;

  const overlayActions: React.ReactNode[] = [];

  overlayActions.push(
    <Button
      key="details"
      size="icon"
      variant="secondary"
      onClick={handleViewDetails}
      className="h-7 w-7 shadow-md"
      title="View Details"
    >
      <Eye className="h-4 w-4" />
    </Button>
  );

  if (surface === 'timeline' && onAddClipToTimeline) {
    overlayActions.push(
      <Button
        key="add-tl"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          onAddClipToTimeline(clip);
        }}
        className="h-7 w-7 shadow-md"
        title="Add to Timeline"
      >
        <Plus className="h-4 w-4" />
      </Button>
    );
  }

  if (surface === 'media-details') {
    overlayActions.push(
      <Dialog
        key="add-timeline-dialog"
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      >
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 shadow-md"
            onClick={(e) => handleOpenAddDialog(e)}
            title="Add to Timeline"
          >
            <ListVideo className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Add Clip to Timeline</DialogTitle>
            <DialogDescription>
              Select a timeline to add this clip to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="timeline-select">Timeline</Label>
              <Select
                value={selectedTimelineId}
                onValueChange={setSelectedTimelineId}
              >
                <SelectTrigger id="timeline-select">
                  <SelectValue placeholder="Select a timeline" />
                </SelectTrigger>
                <SelectContent>
                  {timelines.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No timelines found. Create one first.
                    </div>
                  ) : (
                    timelines.map((timeline) => (
                      <SelectItem key={timeline.id} value={timeline.id}>
                        {timeline.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="p-3 bg-muted rounded-lg space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Clip Duration:</span>
                <span className="font-mono">
                  {(clip.end - clip.start).toFixed(2)}s
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Time Range:</span>
                <span className="font-mono">
                  {formatTime(clip.start)} - {formatTime(clip.end)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setIsAddDialogOpen(false);
              }}
              disabled={isAdding}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleSubmitAddToTimeline();
              }}
              disabled={!selectedTimelineId || isAdding}
            >
              {isAdding ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Timeline
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

    if (clip.type === ClipType.USER && onInlineEditClip) {
      overlayActions.push(
        <Button
          key="inline-edit"
          size="icon"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onInlineEditClip(clip.id);
          }}
          className="h-7 w-7 shadow-md"
          title="Edit with Trim Handles"
        >
          <Scissors className="h-4 w-4" />
        </Button>
      );
    }

    overlayActions.push(
      <Button
        key="edit"
        size="icon"
        variant="secondary"
        onClick={handleOpenEdit}
        className="h-7 w-7 shadow-md"
        title={
          clip.type === ClipType.COMPOSITE
            ? 'Fine-Tune Segments'
            : 'Edit Time Range'
        }
      >
        <Edit className="h-4 w-4" />
      </Button>
    );

    overlayActions.push(
      <AlertDialog key="delete">
        <AlertDialogTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 shadow-md hover:bg-destructive/90 hover:text-white"
            disabled={isDeleting}
            onClick={(e) => e.stopPropagation()}
            title="Delete Clip"
          >
            {isDeleting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clip</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this clip? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <>
      <MediaBaseCard
        media={media}
        spriteFile={media?.expand?.spriteFileRef}
        startTime={clip.start}
        endTime={clip.end}
        onSelect={onSelect ? () => onSelect(item) : undefined}
        className={cn(
          isActive && 'border-primary shadow-md bg-primary/5',
          className
        )}
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
              {surface === 'timeline' ? mediaName : label}
            </div>
            <div className="flex gap-2 text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center justify-between gap-1">
                <span className="opacity-70">In:</span>
                {surface === 'timeline'
                  ? formatTimeMs(clip.start)
                  : formatTime(clip.start)}
              </span>
              <span className="flex items-center justify-between gap-1">
                <span className="opacity-70">Out:</span>
                {surface === 'timeline'
                  ? formatTimeMs(clip.end)
                  : formatTime(clip.end)}
              </span>
            </div>
          </div>
        }
        badges={
          surface === 'timeline'
            ? [
                <div
                  key="duration"
                  className="bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold"
                >
                  {formatTimeMs(clip.end - clip.start)}
                </div>,
              ]
            : undefined
        }
        overlayActions={overlayActions}
        draggable={surface === 'timeline'}
        onDragStart={
          surface === 'timeline'
            ? (e) => {
                e.dataTransfer.setData(
                  'application/json',
                  JSON.stringify(dragPayload)
                );
                e.dataTransfer.effectAllowed = 'copy';
              }
            : undefined
        }
      />

      {detailsClip && (
        <ClipBaseDialog
          open={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          initialMode={dialogMode}
          clip={
            detailsClip as unknown as Parameters<
              typeof ClipBaseDialog
            >[0]['clip']
          }
          onClipUpdated={onClipUpdate}
        />
      )}
    </>
  );
}

// ---------- Media card ----------

interface MediaCardProps extends LibraryItemCardProps {
  item: { kind: 'media'; id: string; media: ExpandedMedia | MediaWithPreviews };
}

function MediaCard({
  item,
  surface,
  isActive = false,
  onSelect,
  onAddMediaToTimeline,
  onCarveClipFromMedia,
  className,
}: MediaCardProps) {
  const media = item.media;
  const duration = media.duration;
  const mediaName =
    (media as ExpandedMedia).expand?.UploadRef?.name || 'Untitled';

  const dragPayload: MediaFullDragPayload = {
    type: 'media-full',
    mediaId: media.id,
    duration,
  };

  const overlayActions: React.ReactNode[] = [];

  if (surface === 'timeline') {
    if (onAddMediaToTimeline) {
      overlayActions.push(
        <Button
          key="add-full"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onAddMediaToTimeline(media);
          }}
          className="h-7 w-7 shadow-md"
          title="Add full-length to timeline"
        >
          <Plus className="h-4 w-4" />
        </Button>
      );
    }
    if (onCarveClipFromMedia) {
      overlayActions.push(
        <Button
          key="carve"
          size="icon"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onCarveClipFromMedia(media);
          }}
          className="h-7 w-7 shadow-md"
          title="Carve new clip from media"
        >
          <Scissors className="h-4 w-4" />
        </Button>
      );
    }
  }

  return (
    <MediaBaseCard
      media={media as Media}
      spriteFile={(media as ExpandedMedia).expand?.spriteFileRef}
      startTime={0}
      endTime={duration}
      onSelect={onSelect ? () => onSelect(item) : undefined}
      className={cn(
        isActive && 'border-primary shadow-md bg-primary/5',
        className
      )}
      title={
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <Badge
            variant="outline"
            className={cn(
              'uppercase text-[10px] font-semibold h-5 px-2',
              isActive && 'border-primary/50 bg-primary/10'
            )}
          >
            {surface === 'timeline' ? 'MEDIA' : 'FULL'}
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
            {surface === 'timeline' ? mediaName : 'Full Video'}
          </div>
          <div className="flex gap-2 text-[10px] text-muted-foreground font-mono">
            <span className="flex items-center justify-between gap-1">
              <span className="opacity-70">In:</span>
              {formatTime(0)}
            </span>
            <span className="flex items-center justify-between gap-1">
              <span className="opacity-70">Out:</span>
              {formatTime(duration)}
            </span>
          </div>
        </div>
      }
      badges={
        surface === 'timeline'
          ? [
              <div
                key="duration"
                className="bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold"
              >
                {formatTimeMs(duration)}
              </div>,
            ]
          : undefined
      }
      overlayActions={overlayActions}
      draggable={surface === 'timeline'}
      onDragStart={
        surface === 'timeline'
          ? (e) => {
              e.dataTransfer.setData(
                'application/json',
                JSON.stringify(dragPayload)
              );
              e.dataTransfer.effectAllowed = 'copy';
            }
          : undefined
      }
    />
  );
}
