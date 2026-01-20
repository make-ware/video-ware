'use client';

import React, { useState } from 'react';
import type { Timeline } from '@project/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Film, Clock, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface TimelineListProps {
  timelines: Timeline[];
  isLoading?: boolean;
  onCreateTimeline: () => void;
  onDeleteTimeline: (timelineId: string) => Promise<void>;
  onTimelineClick: (timeline: Timeline) => void;
  className?: string;
}

export function TimelineList({
  timelines,
  isLoading = false,
  onCreateTimeline,
  onDeleteTimeline,
  onTimelineClick,
  className,
}: TimelineListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [timelineToDelete, setTimelineToDelete] = useState<Timeline | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (timeline: Timeline, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent timeline click
    setTimelineToDelete(timeline);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!timelineToDelete) return;

    setIsDeleting(true);
    try {
      await onDeleteTimeline(timelineToDelete.id);
      setDeleteDialogOpen(false);
      setTimelineToDelete(null);
    } catch (error) {
      console.error('Failed to delete timeline:', error);
      // Error handling could be improved with toast notifications
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex justify-between items-center mb-6">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 w-3/4 bg-muted rounded mb-2" />
              <div className="h-4 w-1/2 bg-muted rounded" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Empty State */}
      {timelines.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Film className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No timelines yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
              Create your first timeline to start assembling clips into a video
              sequence.
            </p>
            <Button onClick={onCreateTimeline}>
              <Plus className="h-4 w-4 mr-2" />
              Create Timeline
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Timeline Cards */}
      {timelines.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {timelines.map((timeline) => (
            <Card
              key={timeline.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => onTimelineClick(timeline)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg line-clamp-1">
                    {timeline.name}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => handleDeleteClick(timeline, e)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardDescription className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="h-3 w-3" />
                    <span>Duration: {formatDuration(timeline.duration)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Hash className="h-3 w-3" />
                    <span>Version: {timeline.version}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Updated{' '}
                    {formatDistanceToNow(new Date(timeline.updated), {
                      addSuffix: true,
                    })}
                  </div>
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Timeline</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{timelineToDelete?.name}
              &quot;? This will also remove all clips from this timeline. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
