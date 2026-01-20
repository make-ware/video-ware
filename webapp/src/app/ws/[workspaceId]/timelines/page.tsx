'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Film, Plus } from 'lucide-react';
import Link from 'next/link';
import { TimelineList } from '@/components/timeline/timeline-list';
import { TimelineService } from '@/services/timeline';
import pb from '@/lib/pocketbase-client';
import type { Timeline } from '@project/shared';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function TimelinesPageContent() {
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTimelineName, setNewTimelineName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Create timeline service - memoized to prevent recreation
  const timelineService = useMemo(() => new TimelineService(pb), []);

  // Load timelines for current workspace
  const loadTimelines = useCallback(async () => {
    if (!currentWorkspace) return;

    setIsLoading(true);
    try {
      const workspaceTimelines = await timelineService.getTimelinesByWorkspace(
        currentWorkspace.id
      );
      setTimelines(workspaceTimelines);
    } catch (error) {
      console.error('Failed to load timelines:', error);
      toast.error('Failed to load timelines');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace, timelineService]);

  // Load timelines on mount and when workspace changes
  useEffect(() => {
    loadTimelines();
  }, [loadTimelines]);

  // Handle create timeline
  const handleCreateTimeline = useCallback(() => {
    setNewTimelineName('');
    setCreateDialogOpen(true);
  }, []);

  const handleConfirmCreate = useCallback(async () => {
    if (!currentWorkspace || !newTimelineName.trim()) return;

    setIsCreating(true);
    try {
      const timeline = await timelineService.createTimeline(
        currentWorkspace.id,
        newTimelineName.trim()
      );
      toast.success(`Timeline "${timeline.name}" created`);
      setCreateDialogOpen(false);
      setNewTimelineName('');
      // Reload timelines
      await loadTimelines();
      // Navigate to the new timeline editor
      router.push(`/ws/${currentWorkspace.id}/timelines/${timeline.id}`);
    } catch (error) {
      console.error('Failed to create timeline:', error);
      toast.error('Failed to create timeline');
    } finally {
      setIsCreating(false);
    }
  }, [
    currentWorkspace,
    newTimelineName,
    timelineService,
    loadTimelines,
    router,
  ]);

  // Handle delete timeline
  const handleDeleteTimeline = useCallback(
    async (timelineId: string) => {
      try {
        await timelineService.deleteTimeline(timelineId);
        toast.success('Timeline deleted');
        // Reload timelines
        await loadTimelines();
      } catch (error) {
        console.error('Failed to delete timeline:', error);
        toast.error('Failed to delete timeline');
        throw error; // Re-throw to let the component handle it
      }
    },
    [timelineService, loadTimelines]
  );

  // Handle timeline click
  const handleTimelineClick = useCallback(
    (timeline: Timeline) => {
      router.push(`/ws/${currentWorkspace?.id}/timelines/${timeline.id}`);
    },
    [router, currentWorkspace]
  );

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 pb-8 max-w-7xl">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2 flex items-center gap-3">
              <Film className="h-8 w-8" />
              Timelines
            </h1>
            <p className="text-lg text-muted-foreground">
              Create and manage video timelines in {currentWorkspace.name}
            </p>
          </div>
          <Button onClick={handleCreateTimeline} size="default">
            <Plus className="h-4 w-4 mr-2" />
            New Timeline
          </Button>
        </div>
      </div>

      {/* Timeline List */}
      <TimelineList
        timelines={timelines}
        isLoading={isLoading}
        onCreateTimeline={handleCreateTimeline}
        onDeleteTimeline={handleDeleteTimeline}
        onTimelineClick={handleTimelineClick}
      />

      {/* Create Timeline Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Timeline</DialogTitle>
            <DialogDescription>
              Give your timeline a name. You can change it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="timeline-name">Timeline Name</Label>
              <Input
                id="timeline-name"
                placeholder="My Video Project"
                value={newTimelineName}
                onChange={(e) => setNewTimelineName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTimelineName.trim()) {
                    handleConfirmCreate();
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmCreate}
              disabled={!newTimelineName.trim() || isCreating}
            >
              {isCreating ? 'Creating...' : 'Create Timeline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TimelinesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  // Show loading state
  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to access timelines.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show workspace selection prompt if no workspace selected
  if (!currentWorkspace) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to view timelines.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TimelinesPageContent />;
}
