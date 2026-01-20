import { vi } from 'vitest';
import type { User } from '@project/shared';
import type { RecordModel, ListResult, RecordListOptions } from 'pocketbase';

/**
 * Mock PocketBase AuthStore
 */
export class MockAuthStore {
  isValid = false;
  model: User | null = null;
  private listeners: Array<(token: string | null, model: User | null) => void> =
    [];

  onChange(callback: (token: string | null, model: User | null) => void) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  clear() {
    this.isValid = false;
    this.model = null;
    this.notifyListeners(null, null);
  }

  setAuth(token: string, model: User) {
    this.isValid = true;
    this.model = model;
    this.notifyListeners(token, model);
  }

  private notifyListeners(token: string | null, model: User | null) {
    this.listeners.forEach((listener) => listener(token, model));
  }
}

/**
 * Simple filter parser for common PocketBase filter patterns
 * Supports: field = "value", field != "value", field > value, field < value, etc.
 */
function parseFilter<T extends RecordModel>(
  filter: string | undefined,
  items: T[]
): T[] {
  if (!filter) return items;

  // Split by && to handle multiple conditions
  const conditions = filter.split('&&').map((c) => c.trim());

  return items.filter((item) => {
    return conditions.every((condition) => {
      // Match: field = "value" or field = 'value'
      const equalsMatch = condition.match(/^(\w+)\s*=\s*["']([^"']+)["']$/);
      if (equalsMatch) {
        const [, field, value] = equalsMatch;
        return (item as any)[field] === value;
      }

      // Match: field != "value"
      const notEqualsMatch = condition.match(/^(\w+)\s*!=\s*["']([^"']+)["']$/);
      if (notEqualsMatch) {
        const [, field, value] = notEqualsMatch;
        return (item as any)[field] !== value;
      }

      // Match: field > value or field >= value
      const gtMatch = condition.match(/^(\w+)\s*(>=?)\s*([\d.]+)$/);
      if (gtMatch) {
        const [, field, op, value] = gtMatch;
        const numValue = parseFloat(value);
        const fieldValue = (item as any)[field];
        return op === '>=' ? fieldValue >= numValue : fieldValue > numValue;
      }

      // Match: field < value or field <= value
      const ltMatch = condition.match(/^(\w+)\s*(<=?)\s*([\d.]+)$/);
      if (ltMatch) {
        const [, field, op, value] = ltMatch;
        const numValue = parseFloat(value);
        const fieldValue = (item as any)[field];
        return op === '<=' ? fieldValue <= numValue : fieldValue < numValue;
      }

      // If no pattern matches, return true (don't filter)
      return true;
    });
  });
}

/**
 * Apply sorting to items
 */
function applySort<T extends RecordModel>(
  items: T[],
  sort: string | undefined
): T[] {
  if (!sort) return items;

  const sorted = [...items];
  const sortFields = sort.split(',').map((s) => s.trim());

  sorted.sort((a, b) => {
    for (const field of sortFields) {
      const isDesc = field.startsWith('-');
      const fieldName = isDesc ? field.substring(1) : field;
      const aVal = (a as any)[fieldName];
      const bVal = (b as any)[fieldName];

      if (aVal === bVal) continue;

      const comparison = aVal < bVal ? -1 : 1;
      return isDesc ? -comparison : comparison;
    }
    return 0;
  });

  return sorted;
}

/**
 * Generic mock PocketBase collection that stores data in memory
 * Supports all main operations: create, update, getOne, getFirstListItem, getList, getFullList, delete
 */
export function createGenericMockCollection<T extends RecordModel>(
  collectionName: string,
  generateId: () => string = () =>
    `${collectionName.toLowerCase()}_${Math.random().toString(36).substring(7)}`
) {
  const storage = new Map<string, T>();

  const collection = {
    /**
     * Create a new record
     */
    create: vi.fn(async (data: any): Promise<T> => {
      const id = data.id || generateId();
      const now = new Date().toISOString();
      const record: T = {
        id,
        collectionId: collectionName.toLowerCase(),
        collectionName,
        created: data.created || now,
        updated: data.updated || now,
        ...data,
        expand: data.expand || {},
      } as T;
      storage.set(id, record);
      return record;
    }),

    /**
     * Update an existing record
     */
    update: vi.fn(async (id: string, data: any): Promise<T> => {
      const existing = storage.get(id);
      if (!existing) {
        throw new Error(`Record not found: ${id}`);
      }
      const updated: T = {
        ...existing,
        ...data,
        updated: new Date().toISOString(),
      } as T;
      storage.set(id, updated);
      return updated;
    }),

    /**
     * Get a record by ID
     */
    getOne: vi.fn(async (id: string, options?: any): Promise<T> => {
      const record = storage.get(id);
      if (!record) {
        const error = new Error('Not found') as any;
        error.status = 404;
        throw error;
      }
      return record;
    }),

    /**
     * Get the first record matching a filter
     */
    getFirstListItem: vi.fn(
      async (filter: string, options?: RecordListOptions): Promise<T> => {
        let items = Array.from(storage.values());

        // Apply filter
        items = parseFilter(filter, items);

        // Apply sort
        if (options?.sort) {
          items = applySort(items, options.sort);
        }

        if (items.length === 0) {
          const error = new Error('Not found') as any;
          error.status = 404;
          throw error;
        }

        return items[0];
      }
    ),

    /**
     * Get a paginated list of records
     */
    getList: vi.fn(
      async (
        page: number,
        perPage: number,
        options?: RecordListOptions
      ): Promise<ListResult<T>> => {
        let items = Array.from(storage.values());

        // Apply filter
        if (options?.filter) {
          items = parseFilter(options.filter, items);
        }

        // Apply sort
        if (options?.sort) {
          items = applySort(items, options.sort);
        }

        // Apply pagination
        const totalItems = items.length;
        const totalPages = Math.ceil(totalItems / perPage);
        const startIndex = (page - 1) * perPage;
        const endIndex = startIndex + perPage;
        const paginatedItems = items.slice(startIndex, endIndex);

        return {
          page,
          perPage,
          totalItems,
          totalPages,
          items: paginatedItems,
        };
      }
    ),

    /**
     * Get all records (no pagination)
     */
    getFullList: vi.fn(async (options?: RecordListOptions): Promise<T[]> => {
      let items = Array.from(storage.values());

      // Apply filter
      if (options?.filter) {
        items = parseFilter(options.filter, items);
      }

      // Apply sort
      if (options?.sort) {
        items = applySort(items, options.sort);
      }

      return items;
    }),

    /**
     * Delete a record
     */
    delete: vi.fn(async (id: string): Promise<boolean> => {
      const exists = storage.has(id);
      if (!exists) {
        const error = new Error('Not found') as any;
        error.status = 404;
        throw error;
      }
      storage.delete(id);
      return true;
    }),

    /**
     * Get access to the internal storage for test setup/verification
     */
    _storage: storage,
  };

  return collection;
}

/**
 * Mock PocketBase Collection (legacy - use createGenericMockCollection for new tests)
 */
export function createMockCollection() {
  const mockCollection = {
    authWithPassword: vi.fn(),
    create: vi.fn(),
    getFullList: vi.fn(),
    getFirstListItem: vi.fn(),
    getOne: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  return mockCollection;
}

/**
 * Mock PocketBase client instance
 */
export function createMockPocketBase(authStore?: MockAuthStore) {
  const store = authStore || new MockAuthStore();
  const mockCollection = createMockCollection();

  const mockPb = {
    authStore: store,
    collection: vi.fn(() => mockCollection),
    autoCancellation: vi.fn(),
    cancelAllRequests: vi.fn(),
    cancelRequest: vi.fn(),
    buildUrl: vi.fn(),
    send: vi.fn(),
  };

  return { mockPb, mockCollection, authStore: store };
}

/**
 * Create mock auth helpers
 */
export function createMockAuthHelpers(
  mockCollection: ReturnType<typeof createMockCollection>
) {
  return {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    isAuthenticated: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  };
}

/**
 * Create a mock user for testing
 */
export function createMockUser(overrides?: Partial<User>): User {
  const id = overrides?.id || `user_${Math.random().toString(36).substring(7)}`;
  const email =
    overrides?.email ||
    `test${Math.random().toString(36).substring(7)}@example.com`;

  return {
    id,
    email,
    name: overrides?.name || 'Test User',
    created: overrides?.created || new Date().toISOString(),
    updated: overrides?.updated || new Date().toISOString(),
    ...overrides,
  } as User;
}
