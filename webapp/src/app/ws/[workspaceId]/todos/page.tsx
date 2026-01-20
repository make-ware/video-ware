'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useTodo } from '@/hooks/use-todo';
import { TodoProvider } from '@/contexts/todo-context';
import { TodoForm } from '@/components/todos/todo-form';
import { TodoList } from '@/components/todos/todo-list';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CheckSquare,
  Plus,
  Filter,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import type { TodoInput, TodoUpdate } from '@project/shared';

export default function TodosPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Redirect to login if not authenticated
    if (!isLoading && !isAuthenticated) {
      router.push(`/login?redirect=${pathname}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="space-y-6">
          {/* Header skeleton */}
          <div className="space-y-2">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-5 w-96" />
          </div>

          {/* Stats skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>

          {/* Form skeleton */}
          <Skeleton className="h-32 w-full" />

          {/* List skeleton */}
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <TodoProvider>
      <TodoPageContent />
    </TodoProvider>
  );
}

function TodoPageContent() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <CheckSquare className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold tracking-tight">My Todos</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Organize and track your tasks efficiently
          </p>
        </div>

        {/* Stats Cards */}
        <TodoStats />

        {/* Todo Form */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            <h2 className="text-xl font-semibold">Add New Task</h2>
          </div>
          <TodoFormWrapper />
        </div>

        {/* Todo List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              <h2 className="text-xl font-semibold">Your Tasks</h2>
            </div>
          </div>
          <TodoListWrapper />
        </div>
      </div>
    </div>
  );
}

function TodoStats() {
  const { todoStats, isLoading } = useTodo();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{todoStats.total}</div>
          <p className="text-xs text-muted-foreground">All your tasks</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Completed</CardTitle>
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{todoStats.completed}</div>
          <p className="text-xs text-muted-foreground">Tasks finished</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending</CardTitle>
          <Plus className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{todoStats.pending}</div>
          <p className="text-xs text-muted-foreground">Tasks remaining</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TodoFormWrapper() {
  const { createTodo, isLoading, error } = useTodo();

  const handleSubmit = async (data: TodoInput) => {
    await createTodo(data);
  };

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}
      <TodoForm
        onSubmit={handleSubmit}
        isLoading={isLoading}
        defaultExpanded={false}
      />
    </div>
  );
}

function TodoListWrapper() {
  const {
    filteredTodos,
    isLoading,
    error,
    toggleComplete,
    deleteTodo,
    filter,
    setFilter,
    sortBy,
    setSortBy,
    clearError,
  } = useTodo();

  const handleToggleComplete = async (id: string) => {
    await toggleComplete(id);
  };

  const handleEdit = async (id: string, data: TodoUpdate) => {
    // TODO: Implement edit functionality
    console.log('Editing todo:', id, data);
  };

  const handleDelete = async (id: string) => {
    await deleteTodo(id);
  };

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <p className="text-sm">{error}</p>
              </div>
              <button
                onClick={clearError}
                className="text-red-600 hover:text-red-800 text-sm underline"
              >
                Dismiss
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      <TodoList
        todos={filteredTodos}
        onToggleComplete={handleToggleComplete}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
        filter={filter}
        onFilterChange={setFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
        todoStats={{
          total: filteredTodos.length,
          completed: filteredTodos.filter((t) => t.completed).length,
          pending: filteredTodos.filter((t) => !t.completed).length,
          completionRate:
            filteredTodos.length > 0
              ? (filteredTodos.filter((t) => t.completed).length /
                  filteredTodos.length) *
                100
              : 0,
        }}
      />
    </div>
  );
}
