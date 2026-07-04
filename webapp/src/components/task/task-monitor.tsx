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
  totalCount?: number;
  isLoading?: boolean;
  className?: string;
}

export function TaskMonitor({
  tasks,
  totalCount,
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

  const formatTaskType = (type: string): string => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
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
      <Card className={cn('py-4 gap-3', className)}>
        <CardHeader className="px-4">
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="px-4">
          <div className="border rounded-lg divide-y divide-gray-200">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-4 rounded-full flex-shrink-0" />
                <Skeleton className="h-4 w-32 flex-shrink-0" />
                <Skeleton className="h-4 w-16 flex-shrink-0 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24 flex-shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('py-4 gap-3', className)}>
      <CardHeader className="px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>Background Tasks</span>
            <Badge variant="secondary">{totalCount ?? tasks.length}</Badge>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="px-4">
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
          <div className="border rounded-lg overflow-hidden">
            {/* Column header row */}
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
              <div className="w-4 flex-shrink-0" />
              <div className="w-32 flex-shrink-0">Type</div>
              <div className="w-20 flex-shrink-0">Status</div>
              <div className="flex-1 min-w-0">Source</div>
              <div className="w-36 flex-shrink-0 text-right">Created</div>
              <div className="w-16 flex-shrink-0 text-right">Duration</div>
              <div className="w-16 flex-shrink-0" />
            </div>

            <div className="divide-y divide-gray-200">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-gray-50 group',
                    task.status === 'failed' && 'bg-red-50 hover:bg-red-100'
                  )}
                  onClick={() => {
                    setSelectedTask(task);
                    setIsModalOpen(true);
                  }}
                >
                  {/* Status icon */}
                  <div className="flex-shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                    {getStatusIcon(task.status as string)}
                  </div>

                  {/* Type */}
                  <p className="w-32 flex-shrink-0 truncate text-sm font-medium text-gray-900">
                    {formatTaskType(task.type)}
                  </p>

                  {/* Status badge */}
                  <Badge
                    variant={getStatusBadgeVariant(task.status as string)}
                    className="flex-shrink-0"
                  >
                    {task.status}
                  </Badge>

                  {/* Source + inline progress/error */}
                  <div className="flex-1 min-w-0 flex items-center gap-2 text-sm text-gray-600">
                    <span className="truncate">
                      {task.status === 'failed' && task.errorLog
                        ? task.errorLog
                        : `${task.sourceType}: ${task.sourceId}`}
                    </span>
                    {task.status === 'running' && (
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        <Progress
                          value={task.progress}
                          className="h-1.5 w-16"
                        />
                        <span className="text-xs text-gray-500">
                          {task.progress}%
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Created */}
                  <div className="hidden sm:block w-36 flex-shrink-0 text-right text-xs text-gray-500">
                    {formatDateTime(task.created)}
                  </div>

                  {/* Duration */}
                  <div className="w-16 flex-shrink-0 text-right text-xs text-gray-500">
                    {formatDuration(task)}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {(task.status === 'failed' ||
                      task.status === 'canceled') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-500 hover:text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          retryTask(task.id);
                        }}
                        title="Retry task"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {(task.status === 'queued' ||
                      task.status === 'running') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-500 hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelTask(task.id);
                        }}
                        title="Cancel task"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  </div>
                </div>
              ))}
            </div>
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
