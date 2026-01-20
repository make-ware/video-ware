'use client';

import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineProvider } from '@/contexts/timeline-context';
import { TimelineRecommendationProvider } from '@/contexts/timeline-recommendation-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { TimelineEditorLayout } from '@/components/timeline/editor/timeline-editor-layout';
import React from 'react';
import Link from 'next/link';

function TimelineEditorPageContent() {
  const params = useParams();
  const timelineId = params.id as string;

  return (
    <TimelineProvider timelineId={timelineId}>
      <TimelineRecommendationProvider timelineId={timelineId}>
        <TimelineEditorLayout />
      </TimelineRecommendationProvider>
    </TimelineProvider>
  );
}

export default function TimelineEditorPage() {
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
            to access the timeline editor.
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
            Please select a workspace from the navigation bar to access the
            timeline editor.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TimelineEditorPageContent />;
}
