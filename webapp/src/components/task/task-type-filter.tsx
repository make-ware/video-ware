'use client';

import { TaskType } from '@project/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Task types that can appear in a workspace list. `cleanup` is omitted: those
 * tasks are created by the storage-cleanup cron without a WorkspaceRef, so a
 * workspace-scoped list never contains them.
 */
export const TASK_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: TaskType.FULL_INGEST, label: 'Full Ingest' },
  { value: TaskType.PROCESS_UPLOAD, label: 'Process Upload' },
  { value: TaskType.DETECT_LABELS, label: 'Detect Labels' },
  { value: TaskType.RENDER_TIMELINE, label: 'Render Timeline' },
];

/**
 * Returns a predicate that tests whether a task type matches the filter
 * value — the client mirror of the type clause `TaskService.listTasks` builds.
 */
export function taskTypeFilterPredicate(
  filterValue: string
): (type: string) => boolean {
  if (!filterValue || filterValue === 'all') return () => true;
  return (type) => type === filterValue;
}

/** `render_timeline` → `Render Timeline`. */
export function formatTaskType(type: string): string {
  const known = TASK_TYPE_OPTIONS.find((option) => option.value === type);
  if (known) return known.label;
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface TaskTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function TaskTypeFilter({
  value,
  onChange,
  className,
}: TaskTypeFilterProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-[170px] h-9'}>
        <SelectValue placeholder="All Types" />
      </SelectTrigger>
      <SelectContent>
        {TASK_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
