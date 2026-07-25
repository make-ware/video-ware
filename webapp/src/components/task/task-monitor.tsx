'use client';

import { useRouter } from 'next/navigation';
import type { Task } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { ChevronRight, Clock, Loader2, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TaskStatusIcon,
  isTaskActive,
  isTaskRetryable,
  taskStatusBadgeVariant,
  taskStatusValue,
} from './task-status-icon';
import { formatTaskType } from './task-type-filter';
import {
  formatTaskDateTime,
  formatTaskDuration,
  formatTaskSource,
} from './task-format';

interface TaskMonitorProps {
  tasks: Task[];
  /** Server-side total; the header badge falls back to tasks.length. */
  totalItems?: number;
  isLoading?: boolean;
  className?: string;
  /** Base path for task detail links (`/ws/{id}/tasks`). */
  tasksHref: string;
  /** True when any filter/search narrows the list (drives empty-state copy). */
  filtersActive?: boolean;
  // Pagination (load-more)
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  // Lifecycle actions
  onRetry?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
  pendingIds?: ReadonlySet<string>;
}

export function TaskMonitor({
  tasks,
  totalItems,
  isLoading = false,
  className,
  tasksHref,
  filtersActive = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  onRetry,
  onCancel,
  pendingIds,
}: TaskMonitorProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <Card className={cn('py-4 gap-3', className)}>
        <CardHeader className="px-4">
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="px-4">
          <div className="border rounded-lg divide-y">
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
            <Badge variant="secondary">{totalItems ?? tasks.length}</Badge>
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
              <EmptyTitle>
                {filtersActive ? 'No matching tasks' : 'No tasks yet'}
              </EmptyTitle>
              <EmptyDescription>
                {filtersActive
                  ? 'Try a different status, type, or search term'
                  : 'Background tasks will appear here when processing uploads'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="border rounded-lg overflow-hidden">
              {/* Column header row */}
              <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-muted/50 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <div className="w-4 flex-shrink-0" />
                <div className="w-32 flex-shrink-0">Type</div>
                <div className="w-20 flex-shrink-0">Status</div>
                <div className="flex-1 min-w-0">Source</div>
                <div className="w-36 flex-shrink-0 text-right">Created</div>
                <div className="w-16 flex-shrink-0 text-right">Duration</div>
                <div className="w-16 flex-shrink-0" />
              </div>

              <div className="divide-y">
                {tasks.map((task) => {
                  const status = taskStatusValue(task.status);
                  const isPending = pendingIds?.has(task.id) ?? false;
                  return (
                    <div
                      key={task.id}
                      role="link"
                      tabIndex={0}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-muted/50 group',
                        status === 'failed' &&
                          'bg-destructive/5 hover:bg-destructive/10'
                      )}
                      onClick={() => router.push(`${tasksHref}/${task.id}`)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        router.push(`${tasksHref}/${task.id}`);
                      }}
                    >
                      {/* Status icon */}
                      <div className="flex-shrink-0">
                        <TaskStatusIcon
                          status={task.status}
                          className="h-4 w-4"
                        />
                      </div>

                      {/* Type */}
                      <p className="w-32 flex-shrink-0 truncate text-sm font-medium text-foreground">
                        {formatTaskType(task.type)}
                      </p>

                      {/* Status badge */}
                      <Badge
                        variant={taskStatusBadgeVariant(task.status)}
                        className="flex-shrink-0"
                      >
                        {status}
                      </Badge>

                      {/* Source + inline progress/error */}
                      <div className="flex-1 min-w-0 flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="truncate">
                          {status === 'failed' && task.errorLog
                            ? task.errorLog
                            : formatTaskSource(task)}
                        </span>
                        {status === 'running' && (
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            <Progress
                              value={task.progress}
                              className="h-1.5 w-16"
                            />
                            <span className="text-xs">{task.progress}%</span>
                          </span>
                        )}
                      </div>

                      {/* Created */}
                      <div className="hidden sm:block w-36 flex-shrink-0 text-right text-xs text-muted-foreground">
                        {formatTaskDateTime(task.created)}
                      </div>

                      {/* Duration */}
                      <div className="w-16 flex-shrink-0 text-right text-xs text-muted-foreground">
                        {formatTaskDuration(task)}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {onRetry && isTaskRetryable(task.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-blue-600"
                            disabled={isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRetry(task.id);
                            }}
                            title="Retry task"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {onCancel && isTaskActive(task.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            disabled={isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCancel(task.id);
                            }}
                            title="Cancel task"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {hasNextPage && onLoadMore && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  onClick={onLoadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </Button>
                {totalItems !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    Showing {tasks.length} of {totalItems}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
