'use client';

import React, { useState } from 'react';
import type { Media, MediaClip, Timeline } from '@project/shared';
import { MediaClipMutator, TimelineMutator } from '@project/shared/mutator';
import { ClipType } from '@project/shared/enums';
import pb from '@/lib/pocketbase-client';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineService } from '@/services/timeline';
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
import { ClipBaseDialog } from './clip-base-dialog';

interface ClipItemProps {
  clip: MediaClip;
  media: Media;
  isActive?: boolean;
  onSelect?: (clip: MediaClip) => void;
  onUpdate?: () => void;
  onDelete?: () => void;
  onInlineEdit?: (clipId: string) => void;
  className?: string;
}

export function ClipItem({
  clip,
  media,
  isActive = false,
  onSelect,
  onUpdate,
  onDelete,
  onInlineEdit,
  className,
}: ClipItemProps) {
  const { currentWorkspace } = useWorkspace();

  // Dialog state
  const [dialogMode, setDialogMode] = useState<'view' | 'edit'>('view');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAddToTimelineDialogOpen, setIsAddToTimelineDialogOpen] =
    useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string>('');

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const mutator = new MediaClipMutator(pb);
      await mutator.delete(clip.id);
      toast.success('Clip deleted successfully');
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete clip:', error);
      toast.error('Failed to delete clip');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenEditDialog = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDialogMode('edit');
    setIsDialogOpen(true);
  };

  const handleOpenAddToTimelineDialog = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentWorkspace) {
      toast.error('No workspace selected');
      return;
    }

    setIsAddToTimelineDialogOpen(true);

    try {
      const timelineMutator = new TimelineMutator(pb);
      const result = await timelineMutator.getByWorkspace(currentWorkspace.id);
      setTimelines(result.items);
    } catch (error) {
      console.error('Failed to load timelines:', error);
      toast.error('Failed to load timelines');
    }
  };

  const handleAddToTimeline = async () => {
    if (!selectedTimelineId) {
      toast.error('Please select a timeline');
      return;
    }

    setIsAddingToTimeline(true);

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
      setIsAddToTimelineDialogOpen(false);
      setSelectedTimelineId('');
    } catch (error) {
      console.error('Failed to add clip to timeline:', error);
      toast.error('Failed to add clip to timeline');
    } finally {
      setIsAddingToTimeline(false);
    }
  };

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogMode('view');
    setIsDialogOpen(true);
  };

  const clipData = (clip.clipData as any) || {};
  const label = typeof clipData.label === 'string' ? clipData.label : 'Clip';

  return (
    <>
      <MediaBaseCard
        media={media}
        startTime={clip.start}
        endTime={clip.end}
        onSelect={() => onSelect?.(clip)}
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
              {label}
            </div>

            {/* Time Info */}
            <div className="flex gap-2 text-[10px] text-muted-foreground font-mono">
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
        overlayActions={
          [
            // Details
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
            // Add to Timeline
            <Dialog
              key="add-timeline"
              open={isAddToTimelineDialogOpen}
              onOpenChange={setIsAddToTimelineDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-7 w-7 shadow-md"
                  onClick={(e) => handleOpenAddToTimelineDialog(e)}
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
                      <span className="text-muted-foreground">
                        Clip Duration:
                      </span>
                      <span className="font-mono">
                        {clip.duration.toFixed(2)}s
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
                      setIsAddToTimelineDialogOpen(false);
                    }}
                    disabled={isAddingToTimeline}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToTimeline();
                    }}
                    disabled={!selectedTimelineId || isAddingToTimeline}
                  >
                    {isAddingToTimeline ? (
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
            </Dialog>,
            // Inline Edit
            clip.type === ClipType.USER && onInlineEdit && (
              <Button
                key="inline-edit"
                size="icon"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onInlineEdit(clip.id);
                }}
                className="h-7 w-7 shadow-md"
                title="Edit with Trim Handles"
              >
                <Scissors className="h-4 w-4" />
              </Button>
            ),
            // Edit
            <Button
              key="edit"
              size="icon"
              variant="secondary"
              onClick={handleOpenEditDialog}
              className="h-7 w-7 shadow-md"
              title={
                clip.type === ClipType.COMPOSITE
                  ? 'Fine-Tune Segments'
                  : 'Edit Time Range'
              }
            >
              <Edit className="h-4 w-4" />
            </Button>,
            // Delete
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
                    Are you sure you want to delete this clip? This action
                    cannot be undone.
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
            </AlertDialog>,
          ].filter(Boolean) as React.ReactNode[]
        }
      />

      <ClipBaseDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        initialMode={dialogMode}
        clip={clip as any}
        onClipUpdated={onUpdate}
      />
    </>
  );
}
