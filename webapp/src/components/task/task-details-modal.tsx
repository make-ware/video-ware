'use client';

import type { Task } from '@project/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  Info,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTasks } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';

interface TaskDetailsModalProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

function InfoRow({ label, value, className }: InfoRowProps) {
  return (
    <div className={cn('flex items-start gap-4 py-2', className)}>
      <dt className="text-sm font-medium text-gray-500 min-w-[120px]">
        {label}
      </dt>
      <dd className="text-sm text-gray-900 flex-1">{value}</dd>
    </div>
  );
}

export function TaskDetailsModal({
  task,
  open,
  onOpenChange,
}: TaskDetailsModalProps) {
  const { retryTask, cancelTask } = useTasks();

  if (!task) return null;

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

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatJSON = (obj: unknown): string => {
    if (!obj) return 'N/A';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(task.status as string)}
              <div>
                <DialogTitle className="text-xl">
                  {formatTaskType(task.type)}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Task ID: {task.id}
                </DialogDescription>
              </div>
            </div>
            <Badge variant={getStatusBadgeVariant(task.status as string)}>
              {task.status}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Status and Progress */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Status & Progress
            </h3>
            <dl className="space-y-1">
              <InfoRow
                label="Status"
                value={
                  <Badge variant={getStatusBadgeVariant(task.status as string)}>
                    {task.status}
                  </Badge>
                }
              />
              {task.status === 'running' && (
                <>
                  <InfoRow
                    label="Progress"
                    value={
                      <div className="space-y-2">
                        <Progress value={task.progress} className="h-2" />
                        <span className="text-sm text-gray-600">
                          {task.progress}%
                        </span>
                      </div>
                    }
                  />
                </>
              )}
              <InfoRow label="Attempts" value={task.attempts || 0} />
              <InfoRow label="Priority" value={task.priority || 0} />
            </dl>
          </div>

          <Separator />

          {/* Source Information */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Source Information
            </h3>
            <dl className="space-y-1">
              <InfoRow label="Source Type" value={task.sourceType} />
              <InfoRow label="Source ID" value={task.sourceId} />
              {task.provider && (
                <InfoRow
                  label="Provider"
                  value={<span className="capitalize">{task.provider}</span>}
                />
              )}
              {task.version && <InfoRow label="Version" value={task.version} />}
            </dl>
          </div>

          <Separator />

          {/* Timestamps */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Timestamps
            </h3>
            <dl className="space-y-1">
              <InfoRow label="Created" value={formatDate(task.created)} />
              <InfoRow label="Updated" value={formatDate(task.updated)} />
            </dl>
          </div>

          {/* Error Log */}
          {task.status === 'failed' && task.errorLog && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  Error Details
                </h3>
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <pre className="text-sm text-red-700 whitespace-pre-wrap font-mono">
                    {task.errorLog}
                  </pre>
                </div>
              </div>
            </>
          )}

          {/* Payload */}
          {task.payload && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Payload
                </h3>
                <div className="p-3 bg-gray-50 border rounded-md">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto">
                    {formatJSON(task.payload)}
                  </pre>
                </div>
              </div>
            </>
          )}

          {/* Result */}
          {task.result && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Result
                </h3>
                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono overflow-x-auto">
                    {formatJSON(task.result)}
                  </pre>
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <Separator />
          <div className="flex items-center justify-end gap-2">
            {(task.status === 'failed' || task.status === 'canceled') && (
              <Button
                variant="outline"
                onClick={() => {
                  retryTask(task.id);
                  onOpenChange(false);
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Task
              </Button>
            )}

            {(task.status === 'queued' || task.status === 'running') && (
              <Button
                variant="destructive"
                onClick={() => {
                  cancelTask(task.id);
                  onOpenChange(false);
                }}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel Task
              </Button>
            )}

            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
