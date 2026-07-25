'use client';

import Link from 'next/link';
import type { Task } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Info,
  RefreshCw,
  X,
} from 'lucide-react';
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
  formatTaskDuration,
  formatTaskJSON,
  formatTaskTimestamp,
} from './task-format';

/**
 * Where a task's source entity lives in the app, when it is reachable. Task
 * sources are plain (sourceType, sourceId) text — there is no relation to
 * expand — so the mapping is by convention: `Media`/`Timeline` sourceIds
 * address their detail pages, and an `upload` task reaches its media through
 * the payload's mediaId (uploads have no detail route of their own).
 */
export function taskSourceLink(
  task: Task,
  workspaceId: string
): { href: string; label: string } | null {
  if (!workspaceId) return null;
  if (task.sourceType === 'Media') {
    return {
      href: `/ws/${workspaceId}/media/${task.sourceId}`,
      label: 'media',
    };
  }
  if (task.sourceType === 'Timeline') {
    return {
      href: `/ws/${workspaceId}/timelines/${task.sourceId}`,
      label: 'timeline',
    };
  }
  if (task.sourceType === 'upload') {
    const payload = task.payload as Record<string, unknown> | undefined;
    const mediaId = payload?.mediaId;
    if (typeof mediaId === 'string' && mediaId) {
      return { href: `/ws/${workspaceId}/media/${mediaId}`, label: 'media' };
    }
  }
  return null;
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

function InfoRow({ label, value, className }: InfoRowProps) {
  return (
    <div className={cn('flex items-start gap-4 py-2', className)}>
      <dt className="text-sm font-medium text-muted-foreground min-w-[120px]">
        {label}
      </dt>
      <dd className="text-sm text-foreground flex-1 min-w-0 break-words">
        {value}
      </dd>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  icon: typeof Info;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3
        className={cn(
          'text-sm font-semibold mb-3 flex items-center gap-2',
          className
        )}
      >
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      {children}
    </div>
  );
}

interface TaskDetailsProps {
  task: Task;
  workspaceId: string;
  onRetry?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
  isPending?: boolean;
  className?: string;
}

export function TaskDetails({
  task,
  workspaceId,
  onRetry,
  onCancel,
  isPending = false,
  className,
}: TaskDetailsProps) {
  const status = taskStatusValue(task.status);
  const sourceLink = taskSourceLink(task, workspaceId);
  const canRetry = !!onRetry && isTaskRetryable(task.status);
  const canCancel = !!onCancel && isTaskActive(task.status);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <TaskStatusIcon status={task.status} />
            <div className="min-w-0">
              <CardTitle className="text-xl">
                {formatTaskType(task.type)}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground font-mono truncate">
                {task.id}
              </p>
            </div>
          </div>
          <Badge variant={taskStatusBadgeVariant(task.status)}>{status}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <Section title="Status & Progress" icon={Info}>
          <dl className="space-y-1">
            {status === 'running' && (
              <InfoRow
                label="Progress"
                value={
                  <div className="space-y-2">
                    <Progress value={task.progress} className="h-2" />
                    <span className="text-sm text-muted-foreground">
                      {task.progress}%
                    </span>
                  </div>
                }
              />
            )}
            <InfoRow label="Attempts" value={task.attempts ?? 0} />
            <InfoRow label="Priority" value={task.priority ?? 0} />
            <InfoRow label="Elapsed" value={formatTaskDuration(task)} />
          </dl>
        </Section>

        <Separator />

        <Section title="Source" icon={Info}>
          <dl className="space-y-1">
            <InfoRow label="Source Type" value={task.sourceType} />
            <InfoRow
              label="Source ID"
              value={
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{task.sourceId}</span>
                  {sourceLink && (
                    <Link
                      href={sourceLink.href}
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      View {sourceLink.label}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </span>
              }
            />
            {task.provider && (
              <InfoRow
                label="Provider"
                value={<span className="capitalize">{task.provider}</span>}
              />
            )}
            {task.version && <InfoRow label="Version" value={task.version} />}
            {task.queueName && <InfoRow label="Queue" value={task.queueName} />}
            {task.bullJobId && (
              <InfoRow
                label="Bull Job ID"
                value={<span className="font-mono">{task.bullJobId}</span>}
              />
            )}
          </dl>
        </Section>

        <Separator />

        <Section title="Timestamps" icon={Clock}>
          <dl className="space-y-1">
            <InfoRow
              label="Created"
              value={formatTaskTimestamp(task.created)}
            />
            <InfoRow
              label="Updated"
              value={formatTaskTimestamp(task.updated)}
            />
          </dl>
        </Section>

        {task.errorLog && (
          <>
            <Separator />
            <Section
              title="Error Details"
              icon={AlertCircle}
              className="text-destructive"
            >
              <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md">
                <pre className="text-sm text-destructive whitespace-pre-wrap font-mono">
                  {task.errorLog}
                </pre>
              </div>
            </Section>
          </>
        )}

        {task.payload && (
          <>
            <Separator />
            <Section title="Payload" icon={Info}>
              <div className="p-3 bg-muted/50 border rounded-md">
                <pre className="text-xs whitespace-pre-wrap font-mono overflow-x-auto">
                  {formatTaskJSON(task.payload)}
                </pre>
              </div>
            </Section>
          </>
        )}

        {task.result && (
          <>
            <Separator />
            <Section title="Result" icon={Info}>
              <div className="p-3 bg-muted/50 border rounded-md">
                <pre className="text-xs whitespace-pre-wrap font-mono overflow-x-auto">
                  {formatTaskJSON(task.result)}
                </pre>
              </div>
            </Section>
          </>
        )}

        {(canRetry || canCancel) && (
          <>
            <Separator />
            <div className="flex items-center justify-end gap-2">
              {canRetry && (
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={() => onRetry?.(task.id)}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Task
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => onCancel?.(task.id)}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel Task
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
