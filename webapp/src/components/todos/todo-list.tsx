'use client';

import { useState } from 'react';
import type { Todo, TodoUpdate } from '@project/shared/schema';
import { TodoItem } from './todo-item';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { CheckSquare, Square, Filter, SortAsc, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TodoFilter, TodoSortOption } from '@/contexts/todo-context';

interface TodoListProps {
  todos: Todo[];
  onToggleComplete: (id: string) => Promise<void>;
  onEdit: (id: string, data: TodoUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isLoading?: boolean;
  filter: TodoFilter;
  onFilterChange: (filter: TodoFilter) => void;
  sortBy: TodoSortOption;
  onSortChange: (sort: TodoSortOption) => void;
  todoStats: {
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
  };
  className?: string;
}

export function TodoList({
  todos,
  onToggleComplete,
  onEdit,
  onDelete,
  isLoading = false,
  filter,
  onFilterChange,
  sortBy,
  onSortChange,
  todoStats,
  className = '',
}: TodoListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTodos, setSelectedTodos] = useState<Set<string>>(new Set());

  const handleEditStart = (id: string) => {
    setEditingId(id);
  };

  const handleEditCancel = () => {
    setEditingId(null);
  };

  const handleSelectTodo = (id: string, selected: boolean) => {
    const newSelected = new Set(selectedTodos);
    if (selected) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedTodos(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTodos.size === todos.length) {
      setSelectedTodos(new Set());
    } else {
      setSelectedTodos(new Set(todos.map((todo) => todo.id)));
    }
  };

  const handleBulkDelete = async () => {
    const promises = Array.from(selectedTodos).map((id) => onDelete(id));
    try {
      await Promise.all(promises);
      setSelectedTodos(new Set());
    } catch (error) {
      console.error('Bulk delete failed:', error);
    }
  };

  const handleBulkToggleComplete = async (completed: boolean) => {
    const todosToToggle = todos.filter(
      (todo) => selectedTodos.has(todo.id) && todo.completed !== completed
    );

    const promises = todosToToggle.map((todo) => onToggleComplete(todo.id));
    try {
      await Promise.all(promises);
      setSelectedTodos(new Set());
    } catch (error) {
      console.error('Bulk toggle failed:', error);
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
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
            <span>Your Todos</span>
            <Badge variant="secondary">{todoStats?.total}</Badge>
          </CardTitle>

          <div className="flex items-center gap-2">
            {/* Filter dropdown */}
            <Select value={filter} onValueChange={onFilterChange}>
              <SelectTrigger className="w-32">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ({todoStats?.total})</SelectItem>
                <SelectItem value="pending">
                  Pending ({todoStats.pending})
                </SelectItem>
                <SelectItem value="completed">
                  Completed ({todoStats.completed})
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Sort dropdown */}
            <Select value={sortBy} onValueChange={onSortChange}>
              <SelectTrigger className="w-36">
                <SortAsc className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">Date Created</SelectItem>
                <SelectItem value="updated">Last Updated</SelectItem>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="completed">Status</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>{todoStats.pending} pending</span>
          <span>{todoStats.completed} completed</span>
          {todoStats?.total > 0 && (
            <span>{todoStats.completionRate}% complete</span>
          )}
        </div>

        {/* Bulk actions */}
        {selectedTodos.size > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {selectedTodos.size} todo{selectedTodos.size !== 1 ? 's' : ''}{' '}
                selected
              </span>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkToggleComplete(true)}
                  className="flex items-center gap-1"
                >
                  <CheckSquare className="h-3 w-3" />
                  Mark Complete
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkToggleComplete(false)}
                  className="flex items-center gap-1"
                >
                  <Square className="h-3 w-3" />
                  Mark Pending
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1 text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTodos(new Set())}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}
      </CardHeader>

      <CardContent>
        {todos.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckSquare className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>
                {filter === 'all' ? 'No todos yet' : `No ${filter} todos`}
              </EmptyTitle>
              <EmptyDescription>
                {filter === 'all'
                  ? 'Create your first todo to get started!'
                  : `You don't have any ${filter} todos.`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-3">
            {/* Select all option */}
            {todos.length > 1 && (
              <div className="flex items-center gap-2 p-2 border rounded-md bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedTodos.size === todos.length}
                  onChange={handleSelectAll}
                  className="rounded"
                />
                <span className="text-sm text-gray-600">
                  Select all {todos.length} todos
                </span>
              </div>
            )}

            {/* Todo items */}
            {todos.map((todo) => (
              <div key={todo.id} className="relative">
                {/* Selection checkbox overlay */}
                {todos.length > 1 && (
                  <div className="absolute top-2 left-2 z-10">
                    <input
                      type="checkbox"
                      checked={selectedTodos.has(todo.id)}
                      onChange={(e) =>
                        handleSelectTodo(todo.id, e.target.checked)
                      }
                      className="rounded"
                    />
                  </div>
                )}

                <TodoItem
                  todo={todo}
                  onToggleComplete={onToggleComplete}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  isEditing={editingId === todo.id}
                  onEditStart={handleEditStart}
                  onEditCancel={handleEditCancel}
                  className={cn(
                    todos.length > 1 && 'ml-8', // Add margin for selection checkbox
                    selectedTodos.has(todo.id) && 'ring-2 ring-blue-500'
                  )}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
