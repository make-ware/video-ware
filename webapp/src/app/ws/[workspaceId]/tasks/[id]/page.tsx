'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTaskDetails } from '@/hooks/use-task-details';
import { useTaskActions } from '@/hooks/use-task-actions';
import { TaskDetails } from '@/components/task';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

function TaskDetailsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  );
}

function TaskDetailsPageContent({ taskId }: { taskId: string }) {
  const { currentWorkspace } = useWorkspace();
  const { task, isLoading, notFound, error, refresh } = useTaskDetails(taskId);
  const { retryTask, cancelTask, pendingIds } = useTaskActions();

  if (!currentWorkspace) {
    return null;
  }

  const tasksHref = `/ws/${currentWorkspace.id}/tasks`;

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href={tasksHref}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            All Tasks
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load task</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading && <TaskDetailsSkeleton />}

      {!isLoading && notFound && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Task not found</AlertTitle>
          <AlertDescription>
            This task no longer exists, or it belongs to another workspace.{' '}
            <Link href={tasksHref} className="underline">
              Back to tasks
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {task && (
        <TaskDetails
          task={task}
          workspaceId={currentWorkspace.id}
          onRetry={retryTask}
          onCancel={cancelTask}
          isPending={pendingIds.has(task.id)}
        />
      )}
    </div>
  );
}

export default function TaskDetailsPage() {
  const params = useParams();
  const taskId = params?.id as string;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

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
            to access tasks.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to view tasks.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TaskDetailsPageContent taskId={taskId} />;
}
