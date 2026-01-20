import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import {
  type Todo,
  type TodoInput,
  type TodoUpdate,
  TodoInputSchema,
} from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class TodoMutator extends BaseMutator<Todo, TodoInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Todo> {
    return this.pb.collection('Todos');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [], // User filtering will be handled automatically by PocketBase access rules
      sort: ['-created'], // Default sort by creation date (newest first)
    };
  }

  protected async validateInput(input: TodoInput): Promise<TodoInput> {
    // Validate the input using the TodoInputSchema
    return TodoInputSchema.parse(input);
  }

  /**
   * Override create method to automatically set the user field from authenticated user
   */
  async create(input: TodoInput): Promise<Todo> {
    try {
      // Get the authenticated user ID
      const userId =
        this.pb.authStore.record?.id || this.pb.authStore.model?.id;
      if (!userId) {
        throw new Error('User must be authenticated to create todos');
      }

      // Validate the input
      const validatedInput = await this.validateInput(input);

      // Add the user field to the data (required by PocketBase access rules)
      // We need to include user field even though it's not in TodoInput schema
      const dataWithUser = {
        ...validatedInput,
        user: userId,
      };

      // Create the record using entityCreate (it will cast to Record<string, any>)
      const record = await this.entityCreate(dataWithUser as TodoInput);
      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Override update method
   */
  async update(id: string, input: TodoUpdate): Promise<Todo> {
    try {
      // Validate partial input using TodoInputSchema.partial()
      const validatedInput = TodoInputSchema.partial().parse(input);
      const record = await this.entityUpdate(
        id,
        validatedInput as Partial<Todo>
      );
      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Toggle the completion status of a todo
   * @param id The ID of the todo to toggle
   * @returns The updated todo
   */
  async toggleComplete(id: string): Promise<Todo> {
    try {
      // First get the current todo to know its current completion status
      const currentTodo = await this.getById(id);
      if (!currentTodo) {
        throw new Error(`Todo with id ${id} not found`);
      }

      // Toggle the completion status
      const updatedTodo = await this.update(id, {
        completed: !currentTodo.completed,
      });

      return updatedTodo;
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Get all todos for a specific user
   * Note: This method is primarily for explicit user filtering in admin contexts.
   * Normal operations will automatically filter by authenticated user via PocketBase access rules.
   * @param userId The ID of the user
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param sort Sort order (optional)
   * @returns List of todos for the user
   */
  async getUserTodos(
    userId: string,
    page = 1,
    perPage = 100,
    sort?: string
  ): Promise<ListResult<Todo>> {
    const filter = `user = "${userId}"`;
    return await this.getList(page, perPage, filter, sort);
  }

  /**
   * Get completed todos for the authenticated user
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param sort Sort order (optional)
   * @returns List of completed todos
   */
  async getCompletedTodos(
    page = 1,
    perPage = 100,
    sort?: string
  ): Promise<ListResult<Todo>> {
    const filter = 'completed = true';
    return await this.getList(page, perPage, filter, sort);
  }

  /**
   * Get pending (incomplete) todos for the authenticated user
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param sort Sort order (optional)
   * @returns List of pending todos
   */
  async getPendingTodos(
    page = 1,
    perPage = 100,
    sort?: string
  ): Promise<ListResult<Todo>> {
    const filter = 'completed = false';
    return await this.getList(page, perPage, filter, sort);
  }

  /**
   * Get todos by completion status for the authenticated user
   * @param completed Whether to get completed or pending todos
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param sort Sort order (optional)
   * @returns List of todos filtered by completion status
   */
  async getTodosByStatus(
    completed: boolean,
    page = 1,
    perPage = 100,
    sort?: string
  ): Promise<ListResult<Todo>> {
    const filter = `completed = ${completed}`;
    return await this.getList(page, perPage, filter, sort);
  }

  /**
   * Search todos by title or description
   * @param searchTerm The term to search for
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param sort Sort order (optional)
   * @returns List of todos matching the search term
   */
  async searchTodos(
    searchTerm: string,
    page = 1,
    perPage = 100,
    sort?: string
  ): Promise<ListResult<Todo>> {
    const filter = `title ~ "${searchTerm}" || description ~ "${searchTerm}"`;
    return await this.getList(page, perPage, filter, sort);
  }

  /**
   * Get todos created within a date range
   * @param startDate Start date (ISO string)
   * @param endDate End date (ISO string)
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @param sort Sort order (optional)
   * @returns List of todos created within the date range
   */
  async getTodosByDateRange(
    startDate: string,
    endDate: string,
    page = 1,
    perPage = 100,
    sort?: string
  ): Promise<ListResult<Todo>> {
    const filter = `created >= "${startDate}" && created <= "${endDate}"`;
    return await this.getList(page, perPage, filter, sort);
  }

  /**
   * Bulk update multiple todos
   * @param updates Array of objects containing id and update data
   * @returns Array of updated todos
   */
  async bulkUpdate(
    updates: Array<{ id: string; data: TodoUpdate }>
  ): Promise<Todo[]> {
    try {
      const updatePromises = updates.map(({ id, data }) =>
        this.update(id, data)
      );
      return await Promise.all(updatePromises);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Bulk delete multiple todos
   * @param ids Array of todo IDs to delete
   * @returns Array of boolean results indicating success/failure for each deletion
   */
  async bulkDelete(ids: string[]): Promise<boolean[]> {
    try {
      const deletePromises = ids.map((id) => this.delete(id));
      return await Promise.all(deletePromises);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Get todo statistics for the authenticated user
   * @returns Object containing todo counts by status
   */
  async getTodoStats(): Promise<{
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
  }> {
    try {
      // Get all todos to calculate stats
      // Note: In a production app with many todos, you might want to use
      // PocketBase's aggregate functions or implement server-side stats
      const allTodos = await this.getList(1, 1000); // Assuming max 1000 todos per user

      const total = allTodos.totalItems;
      const completed = allTodos.items.filter((todo) => todo.completed).length;
      const pending = total - completed;
      const completionRate = total > 0 ? (completed / total) * 100 : 0;

      return {
        total,
        completed,
        pending,
        completionRate: Math.round(completionRate * 100) / 100, // Round to 2 decimal places
      };
    } catch (error) {
      return this.errorWrapper(error);
    }
  }
}
