'use client';

import { useState } from 'react';
import type { Task } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTasks } from '@/hooks/use-tasks';
import { Button } from '@/components/ui/button';
import { TaskDetailsModal } from './task-details-modal';

interface TaskMonitorProps {
  tasks: Task[];
  isLoading?: boolean;
  className?: string;
}

export function TaskMonitor({
  tasks,
  isLoading = false,
  className,
}: TaskMonitorProps) {
  const { retryTask, cancelTask } = useTasks();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'queued':
        return <Clock className="h-5 w-5 text-gray-400" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadgeVariant = (
    status: string
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'success':
        return 'default';
      case 'failed':
        return 'destructive';
      case 'running':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'success':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'running':
        return 'bg-blue-500';
      case 'queued':
        return 'bg-gray-400';
      case 'canceled':
        return 'bg-gray-500';
      default:
        return 'bg-gray-400';
    }
  };

  const formatTaskType = (type: string): string => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year:
        date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDuration = (task: Task): string => {
    const created = new Date(task.created);
    const endTime =
      task.status === 'success' ||
      task.status === 'failed' ||
      task.status === 'canceled'
        ? new Date(task.updated)
        : new Date();

    const diffMs = endTime.getTime() - created.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return `${diffSeconds}s`;
    } else if (diffMinutes < 60) {
      return `${diffMinutes}m ${diffSeconds % 60}s`;
    } else if (diffHours < 24) {
      return `${diffHours}h ${diffMinutes % 60}m`;
    } else {
      return `${diffDays}d ${diffHours % 24}h`;
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>Background Tasks</span>
            <Badge variant="secondary">{tasks.length}</Badge>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent>
        {tasks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No active tasks</EmptyTitle>
              <EmptyDescription>
                Background tasks will appear here when processing uploads
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'relative border rounded-lg cursor-pointer transition-colors hover:bg-gray-50 hover:border-gray-300 overflow-hidden',
                  task.status === 'failed' &&
                    'border-red-200 bg-red-50 hover:bg-red-100',
                  'group'
                )}
                onClick={() => {
                  setSelectedTask(task);
                  setIsModalOpen(true);
                }}
              >
                {/* Status indicator bar */}
                <div
                  className={cn(
                    'absolute left-0 top-0 bottom-0 w-1',
                    getStatusColor(task.status as string)
                  )}
                />

                <div className="p-4 pl-5">
                  {/* Main content grid */}
                  <div className="grid grid-cols-12 gap-4 items-start">
                    {/* Left column: Status icon and task info */}
                    <div className="col-span-8 flex items-start gap-3 min-w-0">
                      {/* Status icon */}
                      <div className="flex-shrink-0 mt-0.5">
                        {getStatusIcon(task.status as string)}
                      </div>

                      {/* Task info */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">
                            {formatTaskType(task.type)}
                          </p>
                          <Badge
                            variant={getStatusBadgeVariant(
                              task.status as string
                            )}
                          >
                            {task.status}
                          </Badge>
                        </div>

                        {/* Source info */}
                        <div className="text-sm text-gray-600">
                          <span className="truncate">
                            {task.sourceType}: {task.sourceId}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right column: Date/Time, Duration, and Metadata */}
                    <div className="col-span-4 flex flex-col items-end gap-1.5 text-right">
                      {/* Date/Time */}
                      <div className="text-sm text-gray-600">
                        {formatDateTime(task.created)}
                      </div>

                      {/* Duration */}
                      <div className="text-sm text-gray-600">
                        <span>
                          {formatDuration(task)}
                          {task.status === 'running' ||
                          task.status === 'queued' ? (
                            <span className="text-gray-500 ml-1">
                              (running)
                            </span>
                          ) : null}
                        </span>
                      </div>

                      {/* Metadata row */}
                      <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-gray-600">
                        <span>{formatDate(task.created)}</span>
                        {task.updated !== task.created && (
                          <>
                            <span className="text-gray-400">•</span>
                            <span>Updated {formatDate(task.updated)}</span>
                          </>
                        )}
                        {task.attempts > 0 && (
                          <>
                            <span className="text-gray-400">•</span>
                            <span>Attempt {task.attempts}</span>
                          </>
                        )}
                        {task.priority !== undefined && task.priority > 0 && (
                          <>
                            <span className="text-gray-400">•</span>
                            <span>Priority {task.priority}</span>
                          </>
                        )}
                        {task.provider && (
                          <>
                            <span className="text-gray-400">•</span>
                            <span className="capitalize">{task.provider}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-gray-200">
                    {/* Left: Progress or version */}
                    <div className="flex-1 min-w-0">
                      {task.status === 'running' && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">Progress</span>
                            <span className="font-medium text-gray-900">
                              {task.progress}%
                            </span>
                          </div>
                          <Progress value={task.progress} className="h-2" />
                        </div>
                      )}
                      {task.status === 'success' && task.version && (
                        <div className="text-sm text-gray-600">
                          Processed with {task.version}
                        </div>
                      )}
                      {task.status === 'failed' && task.errorLog && (
                        <div className="flex items-start gap-2 text-sm text-red-700">
                          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{task.errorLog}</span>
                        </div>
                      )}
                    </div>

                    {/* Right: Action buttons */}
                    <div className="flex items-center gap-1">
                      {(task.status === 'failed' ||
                        task.status === 'canceled') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-500 hover:text-blue-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryTask(task.id);
                          }}
                          title="Retry task"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}

                      {(task.status === 'queued' ||
                        task.status === 'running') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-500 hover:text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelTask(task.id);
                          }}
                          title="Cancel task"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <TaskDetailsModal
        task={selectedTask}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </Card>
  );
}
