'use client';

import React, { useState } from 'react';
import type { Media, MediaClip, Timeline } from '@project/shared';
import { MediaClipMutator, TimelineMutator } from '@project/shared/mutator';
import { ClipType } from '@project/shared/enums';
import {
  validateTimeRange,
  calculateDuration,
} from '@project/shared/utils/time';
import pb from '@/lib/pocketbase-client';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineService } from '@/services/timeline';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Clock,
  Edit,
  Trash2,
  Save,
  X,
  Plus,
  ListVideo,
  Scissors,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '../sprite/sprite-animator';

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

const MIN_CLIP_DURATION = 0.5; // seconds

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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddToTimelineDialogOpen, setIsAddToTimelineDialogOpen] =
    useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string>('');

  // Edit form state
  const [editStart, setEditStart] = useState(clip.start.toString());
  const [editEnd, setEditEnd] = useState(clip.end.toString());
  const [validationError, setValidationError] = useState<string | null>(null);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const formatDetailedTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Validate edit form
  React.useEffect(() => {
    if (!isEditDialogOpen) return;

    const start = parseFloat(editStart);
    const end = parseFloat(editEnd);

    if (isNaN(start) || isNaN(end)) {
      setValidationError('Please enter valid numbers');
      return;
    }

    if (!validateTimeRange(start, end, media.duration)) {
      if (start < 0) {
        setValidationError('Start time cannot be negative');
      } else if (start >= end) {
        setValidationError('Start time must be less than end time');
      } else if (end > media.duration) {
        setValidationError(
          `End time cannot exceed media duration (${media.duration.toFixed(2)}s)`
        );
      } else {
        setValidationError('Invalid time range');
      }
      return;
    }

    const duration = calculateDuration(start, end);
    if (duration < MIN_CLIP_DURATION) {
      setValidationError(`Clip must be at least ${MIN_CLIP_DURATION} seconds`);
      return;
    }

    setValidationError(null);
  }, [editStart, editEnd, media.duration, isEditDialogOpen]);

  const handleEdit = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const start = parseFloat(editStart);
    const end = parseFloat(editEnd);
    const duration = calculateDuration(start, end);

    setIsSaving(true);

    try {
      const mutator = new MediaClipMutator(pb);
      await mutator.update(clip.id, {
        start,
        end,
        duration,
      });

      toast.success('Clip updated successfully');
      setIsEditDialogOpen(false);
      onUpdate?.();
    } catch (error) {
      console.error('Failed to update clip:', error);
      toast.error('Failed to update clip');
    } finally {
      setIsSaving(false);
    }
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
    setEditStart(clip.start.toString());
    setEditEnd(clip.end.toString());
    setValidationError(null);
    setIsEditDialogOpen(true);
  };

  const handleOpenAddToTimelineDialog = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentWorkspace) {
      toast.error('No workspace selected');
      return;
    }

    setIsAddToTimelineDialogOpen(true);

    // Load timelines for the current workspace
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

  const handleCardClick = () => {
    onSelect?.(clip);
  };

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all overflow-hidden p-0',
        isActive
          ? 'border-primary shadow-md bg-primary/5'
          : 'hover:shadow-md hover:border-primary/50 border-border',
        className
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={handleCardClick}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Sprite Preview */}
        <div className="w-32 shrink-0 self-stretch min-h-[80px] bg-muted/50 relative overflow-hidden rounded-l-xl border-r border-border/50">
          <SpriteAnimator
            media={media}
            start={clip.start}
            end={clip.end}
            isHovering={isHovering}
            className="absolute inset-0"
          />
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col justify-center min-w-0 gap-1.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'uppercase text-[10px] font-semibold h-5 px-2',
                isActive && 'border-primary/50 bg-primary/10'
              )}
            >
              {clip.type}
            </Badge>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {formatTime(clip.start)} - {formatTime(clip.end)}
            </span>
          </div>

          <div
            className={cn(
              'text-sm font-medium truncate',
              isActive && 'text-primary'
            )}
          >
            {typeof (clip.clipData as Record<string, unknown>)?.label ===
            'string'
              ? String((clip.clipData as Record<string, unknown>).label)
              : 'Clip'}
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="tabular-nums">{clip.duration.toFixed(1)}s</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col border-l border-border/50 bg-muted/20 lg:bg-transparent">
          {/* Add to Timeline Button */}
          <Dialog
            open={isAddToTimelineDialogOpen}
            onOpenChange={setIsAddToTimelineDialogOpen}
          >
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-full rounded-none border-b border-border/50 hover:bg-primary/10"
                onClick={(e) => handleOpenAddToTimelineDialog(e)}
                title="Add to Timeline"
              >
                <ListVideo className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
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
                  onClick={() => setIsAddToTimelineDialogOpen(false)}
                  disabled={isAddingToTimeline}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  onClick={handleAddToTimeline}
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
          </Dialog>

          {/* Inline Edit Button (for USER clips) */}
          {clip.type === ClipType.USER && onInlineEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-full rounded-none border-b border-border/50 hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                onInlineEdit(clip.id);
              }}
              title="Edit with Trim Handles"
            >
              <Scissors className="h-4 w-4" />
            </Button>
          )}

          {/* Edit Button */}
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-full rounded-none border-b border-border/50 hover:bg-primary/10"
                onClick={(e) => handleOpenEditDialog(e)}
              >
                <Edit className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Clip Time Range</DialogTitle>
                <DialogDescription>
                  Adjust the start and end times for this clip.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-start">Start Time (seconds)</Label>
                  <Input
                    id="edit-start"
                    type="number"
                    step="0.01"
                    min="0"
                    max={media.duration}
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatDetailedTime(parseFloat(editStart) || 0)}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-end">End Time (seconds)</Label>
                  <Input
                    id="edit-end"
                    type="number"
                    step="0.01"
                    min="0"
                    max={media.duration}
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatDetailedTime(parseFloat(editEnd) || 0)}
                  </p>
                </div>

                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">New Duration:</span>
                  <span className="text-sm font-mono">
                    {formatDetailedTime(
                      calculateDuration(
                        parseFloat(editStart) || 0,
                        parseFloat(editEnd) || 0
                      )
                    )}
                  </span>
                </div>

                {validationError && (
                  <p className="text-sm text-destructive">{validationError}</p>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsEditDialogOpen(false)}
                  disabled={isSaving}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  onClick={handleEdit}
                  disabled={!!validationError || isSaving}
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-full rounded-none hover:bg-destructive/10 hover:text-destructive"
                disabled={isDeleting}
                onClick={(e) => e.stopPropagation()}
              >
                {isDeleting ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Clip</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this clip? This action cannot
                  be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
