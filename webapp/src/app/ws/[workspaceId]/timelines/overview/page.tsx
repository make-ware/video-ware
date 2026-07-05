'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AlertCircle, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import pb from '@/lib/pocketbase-client';
import type { Timeline } from '@project/shared';
import { toast } from 'sonner';
import {
  TimelineOverviewCard,
  type OverviewRender,
} from '@/components/timeline/timeline-overview-card';

const MAX_RENDERS_PER_TIMELINE = 3;

function TimelinesOverviewContent() {
  const { currentWorkspace } = useWorkspace();
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [rendersByTimeline, setRendersByTimeline] = useState<
    Record<string, OverviewRender[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!currentWorkspace) return;

    setIsLoading(true);
    try {
      // One query for timelines, one for the workspace's renders — then group
      // client-side (PocketBase has no per-group limit). Renders carry a
      // WorkspaceRef, so the whole workspace's history comes back in one call.
      const [timelinesResult, rendersResult] = await Promise.all([
        pb.collection('Timelines').getList<Timeline>(1, 200, {
          filter: `WorkspaceRef = "${currentWorkspace.id}"`,
          sort: '-updated',
        }),
        pb.collection('TimelineRenders').getList<OverviewRender>(1, 500, {
          filter: `WorkspaceRef = "${currentWorkspace.id}"`,
          sort: '-created',
          expand: 'FileRef',
        }),
      ]);

      // Renders arrive newest-first; keep the first N per timeline.
      const grouped: Record<string, OverviewRender[]> = {};
      for (const render of rendersResult.items) {
        const list = grouped[render.TimelineRef] ?? [];
        if (list.length < MAX_RENDERS_PER_TIMELINE) {
          list.push(render);
          grouped[render.TimelineRef] = list;
        }
      }

      setTimelines(timelinesResult.items);
      setRendersByTimeline(grouped);
    } catch (error) {
      console.error('Failed to load timeline overview:', error);
      toast.error('Failed to load timeline overview');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 pt-6 pb-8">
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="mb-2 flex items-center gap-3 text-4xl font-bold text-foreground">
            <LayoutGrid className="h-8 w-8" />
            Timeline Overview
          </h1>
          <p className="text-lg text-muted-foreground">
            Review and download the latest renders across{' '}
            {currentWorkspace.name}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/ws/${currentWorkspace.id}/timelines`}>
            All timelines
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-1/2 rounded bg-muted" />
                <div className="mt-2 h-4 w-1/3 rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-10 rounded bg-muted" />
                <div className="h-10 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : timelines.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutGrid className="mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-1 text-lg font-semibold">No timelines yet</h3>
            <p className="mb-4 text-muted-foreground">
              Create a timeline to start rendering videos.
            </p>
            <Button asChild>
              <Link href={`/ws/${currentWorkspace.id}/timelines`}>
                Go to Timelines
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {timelines.map((timeline) => (
            <TimelineOverviewCard
              key={timeline.id}
              timeline={timeline}
              renders={rendersByTimeline[timeline.id] ?? []}
              workspaceId={currentWorkspace.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TimelinesOverviewPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  // Show loading state
  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to view the timeline overview.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show workspace selection prompt if no workspace selected
  if (!currentWorkspace) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to view the
            timeline overview.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TimelinesOverviewContent />;
}
