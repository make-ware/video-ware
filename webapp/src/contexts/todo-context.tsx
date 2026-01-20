'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { Todo, TodoInput, TodoUpdate } from '@project/shared';
import { TodoMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { useAuth } from '@/hooks/use-auth';
import type { ListResult, RecordSubscription } from 'pocketbase';

// Filter and sort types
export type TodoFilter = 'all' | 'pending' | 'completed';
export type TodoSortOption = 'created' | 'updated' | 'title' | 'completed';

interface TodoContextType {
  // State
  todos: Todo[];
  isLoading: boolean;
  error: string | null;

  // CRUD operations
  createTodo: (data: TodoInput) => Promise<void>;
  updateTodo: (id: string, data: TodoUpdate) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;

  // Filtering and sorting
  filter: TodoFilter;
  setFilter: (filter: TodoFilter) => void;
  sortBy: TodoSortOption;
  setSortBy: (sort: TodoSortOption) => void;

  // Computed values
  filteredTodos: Todo[];
  todoStats: {
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
  };

  // Real-time updates
  isConnected: boolean;
  subscribe: () => void;
  unsubscribe: () => void;

  // Utility methods
  refreshTodos: () => Promise<void>;
  clearError: () => void;
}

const TodoContext = createContext<TodoContextType | undefined>(undefined);

interface TodoProviderProps {
  children: React.ReactNode;
}

export function TodoProvider({ children }: TodoProviderProps) {
  // State
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [sortBy, setSortBy] = useState<TodoSortOption>('created');
  const [isConnected, setIsConnected] = useState(false);

  // Refs for cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const todoMutatorRef = useRef<TodoMutator | null>(null);

  // Auth context
  const { user, isAuthenticated } = useAuth();

  // Create todo mutator - memoized to prevent recreation
  const todoMutator = useMemo(() => {
    if (!isAuthenticated) return null;
    const mutator = new TodoMutator(pb);
    todoMutatorRef.current = mutator;
    return mutator;
  }, [isAuthenticated]);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Todo ${operation} error:`, error);
    const message =
      error instanceof Error ? error.message : `Failed to ${operation} todo`;
    setError(message);
  }, []);

  // Optimistic update helper
  const optimisticUpdate = useCallback(
    (
      updateFn: (todos: Todo[]) => Todo[],
      rollbackFn?: (todos: Todo[]) => Todo[]
    ) => {
      const previousTodos = todos;
      setTodos(updateFn);

      return {
        rollback: () => {
          if (rollbackFn) {
            setTodos(rollbackFn);
          } else {
            setTodos(previousTodos);
          }
        },
      };
    },
    [todos]
  );

  // Load todos from server
  const loadTodos = useCallback(async () => {
    if (!todoMutator || !isAuthenticated) return;

    setIsLoading(true);
    clearError();

    try {
      // Get all todos for the user (PocketBase access rules handle filtering)
      const result: ListResult<Todo> = await todoMutator.getList(1, 100);
      setTodos(result.items);
    } catch (error) {
      handleError(error, 'load');
    } finally {
      setIsLoading(false);
    }
  }, [todoMutator, isAuthenticated, clearError, handleError]);

  // Refresh todos
  const refreshTodos = useCallback(async () => {
    await loadTodos();
  }, [loadTodos]);

  // Create todo
  const createTodo = useCallback(
    async (data: TodoInput) => {
      if (!todoMutator) throw new Error('Not authenticated');

      clearError();

      // Optimistic update - add temporary todo
      const tempId = `temp-${Date.now()}`;
      const tempTodo: Todo = {
        id: tempId,
        collectionId: 'todos',
        collectionName: 'todos',
        expand: {},
        title: data.title,
        description: data.description || '',
        completed: data.completed || false,
        user: user?.id || '',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      const { rollback } = optimisticUpdate((prev) => [...prev, tempTodo]);

      try {
        const newTodo = await todoMutator.create(data);
        // Replace temp todo with real one
        setTodos((prev) =>
          prev.map((todo) => (todo.id === tempId ? newTodo : todo))
        );
      } catch (error) {
        rollback();
        handleError(error, 'create');
        throw error;
      }
    },
    [todoMutator, user?.id, clearError, handleError, optimisticUpdate]
  );

  // Update todo
  const updateTodo = useCallback(
    async (id: string, data: TodoUpdate) => {
      if (!todoMutator) throw new Error('Not authenticated');

      clearError();

      // Optimistic update
      const { rollback } = optimisticUpdate((prev) =>
        prev.map((todo) =>
          todo.id === id
            ? { ...todo, ...data, updated: new Date().toISOString() }
            : todo
        )
      );

      try {
        const updatedTodo = await todoMutator.update(id, data);
        // Update with server response
        setTodos((prev) =>
          prev.map((todo) => (todo.id === id ? updatedTodo : todo))
        );
      } catch (error) {
        rollback();
        handleError(error, 'update');
        throw error;
      }
    },
    [todoMutator, clearError, handleError, optimisticUpdate]
  );

  // Delete todo
  const deleteTodo = useCallback(
    async (id: string) => {
      if (!todoMutator) throw new Error('Not authenticated');

      clearError();

      // Optimistic update - remove todo
      const { rollback } = optimisticUpdate((prev) =>
        prev.filter((todo) => todo.id !== id)
      );

      try {
        await todoMutator.delete(id);
        // Keep optimistic update
      } catch (error) {
        rollback();
        handleError(error, 'delete');
        throw error;
      }
    },
    [todoMutator, clearError, handleError, optimisticUpdate]
  );

  // Toggle completion
  const toggleComplete = useCallback(
    async (id: string) => {
      if (!todoMutator) throw new Error('Not authenticated');

      clearError();

      // Optimistic update - toggle completion
      const { rollback } = optimisticUpdate((prev) =>
        prev.map((todo) =>
          todo.id === id
            ? {
                ...todo,
                completed: !todo.completed,
                updated: new Date().toISOString(),
              }
            : todo
        )
      );

      try {
        const updatedTodo = await todoMutator.toggleComplete(id);
        // Update with server response
        setTodos((prev) =>
          prev.map((todo) => (todo.id === id ? updatedTodo : todo))
        );
      } catch (error) {
        rollback();
        handleError(error, 'toggle completion');
        throw error;
      }
    },
    [todoMutator, clearError, handleError, optimisticUpdate]
  );

  // Real-time subscription management
  const subscribe = useCallback(async () => {
    if (!todoMutator || !isAuthenticated || unsubscribeRef.current) return;

    try {
      // Subscribe to all todos collection changes
      const unsubscribe = await new Promise<() => void>((resolve, reject) => {
        pb.collection('Todos')
          .subscribe(
            '*',
            (data: RecordSubscription<Todo>) => {
              // Handle real-time updates
              if (data.action === 'create') {
                setTodos((prev) => {
                  // Avoid duplicates (in case of optimistic updates)
                  const exists = prev.some(
                    (todo) => todo.id === data.record.id
                  );
                  return exists ? prev : [...prev, data.record];
                });
              } else if (data.action === 'update') {
                setTodos((prev) =>
                  prev.map((todo) =>
                    todo.id === data.record.id ? data.record : todo
                  )
                );
              } else if (data.action === 'delete') {
                setTodos((prev) =>
                  prev.filter((todo) => todo.id !== data.record.id)
                );
              }
            },
            {
              // No expand needed for todos currently
            }
          )
          .then(() => {
            setIsConnected(true);
            return () => {
              pb.collection('Todos').unsubscribe('*');
              setIsConnected(false);
            };
          })
          .catch(reject);

        // Return the unsubscribe function
        resolve(() => {
          pb.collection('Todos').unsubscribe('*');
          setIsConnected(false);
        });
      });

      unsubscribeRef.current = unsubscribe;
      setIsConnected(true);
    } catch (error) {
      console.error('Subscription error:', error);
      setIsConnected(false);
    }
  }, [todoMutator, isAuthenticated]);

  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Computed values
  const filteredTodos = useMemo(() => {
    let filtered = todos;

    // Apply filter
    if (filter === 'completed') {
      filtered = filtered.filter((todo) => todo.completed);
    } else if (filter === 'pending') {
      filtered = filtered.filter((todo) => !todo.completed);
    }

    // Apply sort
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'completed':
          return Number(a.completed) - Number(b.completed);
        case 'updated':
          return new Date(b.updated).getTime() - new Date(a.updated).getTime();
        case 'created':
        default:
          return new Date(b.created).getTime() - new Date(a.created).getTime();
      }
    });
  }, [todos, filter, sortBy]);

  const todoStats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter((todo) => todo.completed).length;
    const pending = total - completed;
    const completionRate = total > 0 ? (completed / total) * 100 : 0;

    return {
      total,
      completed,
      pending,
      completionRate: Math.round(completionRate * 100) / 100,
    };
  }, [todos]);

  // Initialize todos when authenticated
  useEffect(() => {
    if (isAuthenticated && todoMutator) {
      loadTodos();
      subscribe();
    } else {
      // Clear todos when not authenticated
      setTodos([]);
      setIsLoading(false);
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [isAuthenticated, todoMutator, loadTodos, subscribe, unsubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  const value: TodoContextType = {
    // State
    todos,
    isLoading,
    error,

    // CRUD operations
    createTodo,
    updateTodo,
    deleteTodo,
    toggleComplete,

    // Filtering and sorting
    filter,
    setFilter,
    sortBy,
    setSortBy,

    // Computed values
    filteredTodos,
    todoStats,

    // Real-time updates
    isConnected,
    subscribe,
    unsubscribe,

    // Utility methods
    refreshTodos,
    clearError,
  };

  return <TodoContext.Provider value={value}>{children}</TodoContext.Provider>;
}

// Export the context for use in the hook
export { TodoContext };
