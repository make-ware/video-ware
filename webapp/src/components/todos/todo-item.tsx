'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TodoInputSchema } from '@project/shared/schema';
import type { Todo, TodoUpdate } from '@project/shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Edit2, Trash2, Save, X, Calendar, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TodoItemProps {
  todo: Todo;
  onToggleComplete: (id: string) => Promise<void>;
  onEdit: (id: string, data: TodoUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isEditing?: boolean;
  onEditStart?: (id: string) => void;
  onEditCancel?: () => void;
  className?: string;
}

export function TodoItem({
  todo,
  onToggleComplete,
  onEdit,
  onDelete,
  isEditing = false,
  onEditStart,
  onEditCancel,
  className = '',
}: TodoItemProps) {
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
  } = useForm<TodoUpdate>({
    resolver: zodResolver(TodoInputSchema.partial()),
    defaultValues: {
      title: todo.title,
      description: todo.description || '',
    },
  });

  const handleToggleComplete = async () => {
    setIsToggling(true);
    try {
      await onToggleComplete(todo.id);
    } catch (error: unknown) {
      console.error('Toggle completion failed:', error);
      const errorDescription = String(
        (error as { message?: string })?.message || 'unknown'
      );
      toast.error('Failed to update todo', {
        description: errorDescription,
      });
    } finally {
      setIsToggling(false);
    }
  };

  const handleEditStart = () => {
    if (onEditStart) {
      onEditStart(todo.id);
    }
    // Reset form with current values
    reset({
      title: todo.title,
      description: todo.description || '',
    });
  };

  const handleEditCancel = () => {
    if (onEditCancel) {
      onEditCancel();
    }
    // Reset form to original values
    reset({
      title: todo.title,
      description: todo.description || '',
    });
  };

  const handleEditSubmit = async (data: TodoUpdate) => {
    setIsUpdating(true);
    try {
      await onEdit(todo.id, data);
      toast.success('Todo updated successfully!');
      if (onEditCancel) {
        onEditCancel();
      }
    } catch (error: unknown) {
      console.error('Todo update failed:', error);

      // Handle validation errors
      if (
        error &&
        typeof error === 'object' &&
        'data' in error &&
        error.data &&
        typeof error.data === 'object' &&
        'data' in error.data
      ) {
        const fieldErrors = (
          error.data as { data: Record<string, { message?: string }> }
        ).data;
        Object.keys(fieldErrors).forEach((field) => {
          if (field === 'title' || field === 'description') {
            setError(field, {
              type: 'manual',
              message: fieldErrors[field].message || `Invalid ${field}`,
            });
          }
        });
      } else {
        // General error
        const errorMessage = String(
          (error as { message?: string })?.message || 'unknown'
        );
        setError('root', {
          type: 'manual',
          message: errorMessage,
        });
      }

      const errorDescription = String(
        (error as { message?: string })?.message || 'unknown'
      );
      toast.error('Failed to update todo', {
        description: errorDescription,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(todo.id);
      toast.success('Todo deleted successfully!');
    } catch (error: unknown) {
      console.error('Todo deletion failed:', error);
      const errorDescription = String(
        (error as { message?: string })?.message || 'unknown'
      );
      toast.error('Failed to delete todo', {
        description: errorDescription,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isLoading = isToggling || isDeleting || isUpdating;

  return (
    <Card
      className={cn(
        'transition-all duration-200 hover:shadow-md',
        todo.completed && 'opacity-75 bg-gray-50',
        className
      )}
    >
      <CardContent className="p-4">
        {isEditing ? (
          // Edit mode
          <form onSubmit={handleSubmit(handleEditSubmit)} className="space-y-3">
            <div className="space-y-2">
              <Input
                {...register('title')}
                placeholder="Todo title"
                disabled={isUpdating}
                className={errors.title ? 'border-red-500' : ''}
              />
              {errors.title && (
                <p className="text-sm text-red-600">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Textarea
                {...register('description')}
                placeholder="Description (optional)"
                disabled={isUpdating}
                rows={2}
                className={errors.description ? 'border-red-500' : ''}
              />
              {errors.description && (
                <p className="text-sm text-red-600">
                  {errors.description.message}
                </p>
              )}
            </div>

            {errors.root && (
              <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                {errors.root.message}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={isUpdating}
                className="flex items-center gap-1"
              >
                <Save className="h-3 w-3" />
                {isUpdating ? 'Saving...' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleEditCancel}
                disabled={isUpdating}
                className="flex items-center gap-1"
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          // View mode
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                checked={todo.completed}
                onCheckedChange={handleToggleComplete}
                disabled={isLoading}
                className="mt-1"
              />

              <div className="flex-1 min-w-0">
                <h3
                  className={cn(
                    'font-medium text-gray-900 break-words',
                    todo.completed && 'line-through text-gray-500'
                  )}
                >
                  {todo.title}
                </h3>

                {todo.description && (
                  <p
                    className={cn(
                      'mt-1 text-sm text-gray-600 break-words',
                      todo.completed && 'line-through text-gray-400'
                    )}
                  >
                    {todo.description}
                  </p>
                )}

                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>Created {formatDate(todo.created)}</span>
                  </div>

                  {todo.updated !== todo.created && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>Updated {formatTime(todo.updated)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleEditStart}
                  disabled={isLoading}
                  className="h-8 w-8 p-0"
                >
                  <Edit2 className="h-3 w-3" />
                  <span className="sr-only">Edit todo</span>
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isLoading}
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span className="sr-only">Delete todo</span>
                    </Button>
                  </AlertDialogTrigger>

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Todo</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete &quot;{todo.title}
                        &quot;? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
