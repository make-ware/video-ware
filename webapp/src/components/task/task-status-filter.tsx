'use client';

import { TaskStatus } from '@project/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { taskStatusValue } from './task-status-icon';

export const TASK_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: TaskStatus.QUEUED, label: 'Queued' },
  { value: TaskStatus.RUNNING, label: 'Running' },
  { value: TaskStatus.SUCCESS, label: 'Success' },
  { value: TaskStatus.FAILED, label: 'Failed' },
  { value: TaskStatus.CANCELED, label: 'Canceled' },
];

/**
 * Returns a predicate that tests whether a task status matches the filter
 * value — the client mirror of the status clause `TaskService.listTasks`
 * builds ('active' = queued or running).
 */
export function taskStatusFilterPredicate(
  filterValue: string
): (status: string | string[]) => boolean {
  if (!filterValue || filterValue === 'all') return () => true;
  if (filterValue === 'active') {
    return (status) => {
      const value = taskStatusValue(status);
      return value === TaskStatus.QUEUED || value === TaskStatus.RUNNING;
    };
  }
  return (status) => taskStatusValue(status) === filterValue;
}

interface TaskStatusFilterProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function TaskStatusFilter({
  value,
  onChange,
  className,
}: TaskStatusFilterProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-[150px] h-9'}>
        <SelectValue placeholder="All Statuses" />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUS_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
