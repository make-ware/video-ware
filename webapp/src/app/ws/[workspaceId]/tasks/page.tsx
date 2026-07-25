'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTaskList } from '@/hooks/use-task-list';
import { useTaskActions } from '@/hooks/use-task-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, ListChecks, Search } from 'lucide-react';
import {
  TaskMonitor,
  TaskStatusFilter,
  TaskTypeFilter,
  TASK_SORT_OPTIONS,
  DEFAULT_TASK_SORT,
  getTaskSortOption,
  type TaskSortValue,
} from '@/components/task';

const DEFAULT_STATUS_FILTER = 'all';
const DEFAULT_TYPE_FILTER = 'all';

function TasksPageContent() {
  const { currentWorkspace } = useWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get('status') ?? DEFAULT_STATUS_FILTER
  );
  const [typeFilter, setTypeFilter] = useState<string>(
    searchParams.get('type') ?? DEFAULT_TYPE_FILTER
  );
  const [sort, setSort] = useState<TaskSortValue>(
    getTaskSortOption(searchParams.get('sort')).value
  );
  // Search is transient (debounced input) and deliberately not URL-synced.
  const [searchQuery, setSearchQuery] = useState('');

  const {
    items: tasks,
    totalItems,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    loadMore,
    error,
  } = useTaskList({
    workspaceId: currentWorkspace?.id,
    statusFilter,
    typeFilter,
    searchQuery,
    sort,
  });

  const { retryTask, cancelTask, pendingIds } = useTaskActions();

  // Build a URL that preserves the status, type, and sort params
  const buildTasksUrl = useCallback(
    (status: string, type: string, sortValue: TaskSortValue) => {
      const params = new URLSearchParams();
      if (status !== DEFAULT_STATUS_FILTER) params.set('status', status);
      if (type !== DEFAULT_TYPE_FILTER) params.set('type', type);
      if (sortValue !== DEFAULT_TASK_SORT) params.set('sort', sortValue);
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname]
  );

  // Sync URL → state when the browser navigates back/forward. Filter changes
  // below write the URL with replaceState (no popstate, no new entry), so the
  // history event is the only way the URL can change under us.
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setStatusFilter(params.get('status') ?? DEFAULT_STATUS_FILTER);
      setTypeFilter(params.get('type') ?? DEFAULT_TYPE_FILTER);
      setSort(getTaskSortOption(params.get('sort')).value);
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // Update URL when filters change (replaceState avoids Next.js soft
  // navigation/remount)
  const handleStatusChange = useCallback(
    (value: string) => {
      setStatusFilter(value);
      window.history.replaceState(
        null,
        '',
        buildTasksUrl(value, typeFilter, sort)
      );
    },
    [buildTasksUrl, typeFilter, sort]
  );

  const handleTypeChange = useCallback(
    (value: string) => {
      setTypeFilter(value);
      window.history.replaceState(
        null,
        '',
        buildTasksUrl(statusFilter, value, sort)
      );
    },
    [buildTasksUrl, statusFilter, sort]
  );

  const handleSortChange = useCallback(
    (value: string) => {
      const sortValue = getTaskSortOption(value).value;
      setSort(sortValue);
      window.history.replaceState(
        null,
        '',
        buildTasksUrl(statusFilter, typeFilter, sortValue)
      );
    },
    [buildTasksUrl, statusFilter, typeFilter]
  );

  if (!currentWorkspace) {
    return null;
  }

  const filtersActive =
    statusFilter !== DEFAULT_STATUS_FILTER ||
    typeFilter !== DEFAULT_TYPE_FILTER ||
    searchQuery.trim().length > 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      {/* Page Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
          <ListChecks className="h-6 w-6" />
          Background Tasks
        </h1>
        <p className="text-sm text-muted-foreground">
          Monitor and manage background operations in {currentWorkspace.name}
        </p>
      </div>

      {/* Filters: search + sort + status + type */}
      <div className="mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by source, type, id, or error..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {TASK_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TaskStatusFilter value={statusFilter} onChange={handleStatusChange} />
        <TaskTypeFilter value={typeFilter} onChange={handleTypeChange} />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load tasks</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <TaskMonitor
        tasks={tasks}
        totalItems={totalItems}
        isLoading={isLoading}
        tasksHref={`/ws/${currentWorkspace.id}/tasks`}
        filtersActive={filtersActive}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={loadMore}
        onRetry={retryTask}
        onCancel={cancelTask}
        pendingIds={pendingIds}
      />
    </div>
  );
}

export default function TasksPage() {
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
            to access tasks.
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
            Please select a workspace from the navigation bar to view tasks.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TasksPageContent />;
}
