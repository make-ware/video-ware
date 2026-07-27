'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimelinesOverview } from '@/hooks/use-timelines-overview';
import { qk } from '@/lib/query-keys';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Film, Plus } from 'lucide-react';
import Link from 'next/link';
import { TimelineOverviewCard } from '@/components/timeline/timeline-overview-card';
import { TimelineService } from '@/services/timeline';
import pb from '@/lib/pocketbase-client';
import type { Timeline } from '@project/shared';
import { toast } from 'sonner';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 12;

function getPageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function TimelinesPageContent() {
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTimelineName, setNewTimelineName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [timelineToDelete, setTimelineToDelete] = useState<Timeline | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Create timeline service - memoized to prevent recreation
  const timelineService = useMemo(() => new TimelineService(pb), []);

  const { items, totalPages, isLoading, error } = useTimelinesOverview(
    currentWorkspace?.id,
    page,
    PAGE_SIZE
  );

  // If the current page disappears (e.g. the last item on it was deleted),
  // fall back to the new last page.
  useEffect(() => {
    if (!isLoading && totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [isLoading, totalPages, page]);

  const invalidateTimelines = useCallback(
    () => queryClient.invalidateQueries({ queryKey: qk.timelines.all }),
    [queryClient]
  );

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
      await invalidateTimelines();
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
    invalidateTimelines,
    router,
  ]);

  // Handle delete timeline
  const handleConfirmDelete = useCallback(async () => {
    if (!timelineToDelete) return;

    setIsDeleting(true);
    try {
      await timelineService.deleteTimeline(timelineToDelete.id);
      toast.success('Timeline deleted');
      setTimelineToDelete(null);
      await invalidateTimelines();
    } catch (error) {
      console.error('Failed to delete timeline:', error);
      toast.error('Failed to delete timeline');
    } finally {
      setIsDeleting(false);
    }
  }, [timelineToDelete, timelineService, invalidateTimelines]);

  if (!currentWorkspace) {
    return null;
  }

  const goTo = (p: number) => setPage(Math.max(1, Math.min(totalPages, p)));

  const pageNumbers = getPageNumbers(page, totalPages);
  const showStartEllipsis = pageNumbers.length > 0 && pageNumbers[0] > 1;
  const showEndEllipsis =
    pageNumbers.length > 0 && pageNumbers[pageNumbers.length - 1] < totalPages;

  return (
    <div className="container mx-auto px-3 pt-4 pb-8 sm:px-4 sm:pt-6 max-w-7xl">
      {/* Page Header */}
      <div className="mb-4 sm:mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-4xl font-bold text-foreground mb-1 sm:mb-2 flex items-center gap-2 sm:gap-3">
              <Film className="h-6 w-6 sm:h-8 sm:w-8" />
              Timelines
            </h1>
            <p className="text-sm sm:text-lg text-muted-foreground">
              Create timelines and review recent renders in{' '}
              {currentWorkspace.name}
            </p>
          </div>
          <Button
            onClick={handleCreateTimeline}
            size="default"
            className="w-full sm:w-auto sm:shrink-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Timeline
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-1/2 rounded bg-muted" />
                <div className="mt-2 h-4 w-1/3 rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-16 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load timelines</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center px-4 py-12 text-center sm:py-16">
            <Film className="mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-1 text-lg font-semibold">No timelines yet</h3>
            <p className="mb-4 text-sm text-muted-foreground sm:text-base">
              Create your first timeline to start assembling clips into a video
              sequence.
            </p>
            <Button onClick={handleCreateTimeline} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Create Timeline
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
            {items.map(({ timeline, latestRender }) => (
              <TimelineOverviewCard
                key={timeline.id}
                timeline={timeline}
                latestRender={latestRender}
                workspaceId={currentWorkspace.id}
                onDelete={setTimelineToDelete}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={page === 1}
                    className={
                      page === 1 ? 'pointer-events-none opacity-50' : undefined
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      goTo(page - 1);
                    }}
                  />
                </PaginationItem>

                {showStartEllipsis && (
                  <>
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          goTo(1);
                        }}
                      >
                        1
                      </PaginationLink>
                    </PaginationItem>
                    {pageNumbers[0] > 2 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}
                  </>
                )}

                {pageNumbers.map((p) => (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={(e) => {
                        e.preventDefault();
                        goTo(p);
                      }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}

                {showEndEllipsis && (
                  <>
                    {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          goTo(totalPages);
                        }}
                      >
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                )}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={page === totalPages}
                    className={
                      page === totalPages
                        ? 'pointer-events-none opacity-50'
                        : undefined
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      goTo(page + 1);
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}

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

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!timelineToDelete}
        onOpenChange={(open) => {
          if (!open) setTimelineToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Timeline</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{timelineToDelete?.name}
              &quot;? This will also remove all clips and renders from this
              timeline. This action cannot be undone.
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
