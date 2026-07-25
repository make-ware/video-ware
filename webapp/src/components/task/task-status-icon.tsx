'use client';

import { TaskStatus } from '@project/shared';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Slash,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** A PocketBase select field can surface as a single-element array. */
export function taskStatusValue(status: string | string[]): string {
  return Array.isArray(status) ? (status[0] ?? '') : status;
}

interface StatusPresentation {
  icon: LucideIcon;
  className: string;
  spin?: boolean;
}

const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  [TaskStatus.SUCCESS]: { icon: CheckCircle2, className: 'text-green-500' },
  [TaskStatus.FAILED]: { icon: XCircle, className: 'text-red-500' },
  [TaskStatus.RUNNING]: {
    icon: Loader2,
    className: 'text-blue-500',
    spin: true,
  },
  [TaskStatus.QUEUED]: { icon: Clock, className: 'text-muted-foreground' },
  [TaskStatus.CANCELED]: { icon: Slash, className: 'text-muted-foreground' },
};

interface TaskStatusIconProps {
  status: string | string[];
  className?: string;
}

export function TaskStatusIcon({ status, className }: TaskStatusIconProps) {
  const presentation = STATUS_PRESENTATION[taskStatusValue(status)] ?? {
    icon: AlertCircle,
    className: 'text-muted-foreground',
  };
  const Icon = presentation.icon;
  return (
    <Icon
      className={cn(
        'h-5 w-5',
        presentation.className,
        presentation.spin && 'animate-spin',
        className
      )}
    />
  );
}

export function taskStatusBadgeVariant(
  status: string | string[]
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (taskStatusValue(status)) {
    case TaskStatus.SUCCESS:
      return 'default';
    case TaskStatus.FAILED:
      return 'destructive';
    case TaskStatus.RUNNING:
      return 'secondary';
    default:
      return 'outline';
  }
}

/** True for tasks that can still be canceled. */
export function isTaskActive(status: string | string[]): boolean {
  const value = taskStatusValue(status);
  return value === TaskStatus.QUEUED || value === TaskStatus.RUNNING;
}

/** True for tasks that can be requeued. */
export function isTaskRetryable(status: string | string[]): boolean {
  const value = taskStatusValue(status);
  return value === TaskStatus.FAILED || value === TaskStatus.CANCELED;
}
