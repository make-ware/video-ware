'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TodoInput } from '@project/shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { z } from 'zod';

// Create a form-specific schema without defaults to avoid type issues
const TodoFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
});

type TodoFormData = z.infer<typeof TodoFormSchema>;

interface TodoFormProps {
  onSubmit: (data: TodoInput) => Promise<void>;
  isLoading?: boolean;
  className?: string;
  defaultExpanded?: boolean;
}

export function TodoForm({
  onSubmit,
  isLoading = false,
  className = '',
  defaultExpanded = false,
}: TodoFormProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
  } = useForm<TodoFormData>({
    resolver: zodResolver(TodoFormSchema),
    defaultValues: {
      title: '',
      description: '',
    },
  });

  const handleFormSubmit = async (data: TodoFormData) => {
    setIsSubmitting(true);
    try {
      // Convert form data to TodoInput format
      const todoData: TodoInput = {
        title: data.title,
        description: data.description,
        completed: false, // Always start as incomplete
      };

      await onSubmit(todoData);

      // Clear form on success
      reset();
      toast.success('Todo created successfully!');

      // Collapse form after successful creation
      setIsExpanded(false);
    } catch (error: unknown) {
      console.error('Todo creation failed:', error);

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
      toast.error('Failed to create todo', {
        description: errorDescription,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    reset();
    setIsExpanded(false);
  };

  const isFormLoading = isLoading || isSubmitting;

  return (
    <Card className={className}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors">
            <CardTitle className="flex items-center justify-between text-lg">
              <span className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Add New Todo
              </span>
              {isExpanded ? (
                <X className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent>
            <form
              onSubmit={handleSubmit(handleFormSubmit)}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="title">
                  Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="title"
                  type="text"
                  {...register('title')}
                  placeholder="What needs to be done?"
                  disabled={isFormLoading}
                  className={errors.title ? 'border-red-500' : ''}
                />
                {errors.title && (
                  <p className="text-sm text-red-600">{errors.title.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  {...register('description')}
                  placeholder="Add more details (optional)"
                  disabled={isFormLoading}
                  rows={3}
                  className={errors.description ? 'border-red-500' : ''}
                />
                {errors.description && (
                  <p className="text-sm text-red-600">
                    {errors.description.message}
                  </p>
                )}
              </div>

              {errors.root && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                  {errors.root.message}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  type="submit"
                  disabled={isFormLoading}
                  className="flex-1"
                >
                  {isFormLoading ? 'Creating...' : 'Create Todo'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isFormLoading}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
