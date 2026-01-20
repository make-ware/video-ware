import {
  RecordService,
  type ListResult,
  type RecordListOptions,
  type RecordModel,
  type RecordOptions,
  type RecordSubscribeOptions,
  type RecordSubscription,
  type UnsubscribeFunc,
} from 'pocketbase';
import type { Expanded, TypedPocketBase } from '../types';

export interface MutatorOptions {
  expand: string[];
  filter: string[];
  sort: string[];
}

// T represents the output model type that extends RecordModel
// InputType represents the input type for creation operations
export abstract class BaseMutator<
  T extends RecordModel,
  InputType,
  Relations = Record<string, any>,
> {
  protected pb: TypedPocketBase;

  // Define a default property that subclasses will override
  protected options: MutatorOptions = {
    expand: [],
    filter: [],
    sort: [],
  };

  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    this.pb = pb;

    // Initialize with default options first
    this.initializeOptions();
    if (options) {
      this.overrideOptions(options);
    }
  }

  private initializeOptions(): void {
    this.options = this.setDefaults();
  }
  /**
   * Initialize options with class-specific defaults
   * Subclasses should override this instead of directly setting options
   */
  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: [],
    };
  }

  /**
   * Merge provided options with current options
   */
  protected overrideOptions(newOptions: Partial<MutatorOptions>): void {
    if (newOptions.expand !== undefined) {
      this.options.expand = newOptions.expand;
    }
    if (newOptions.filter !== undefined) {
      this.options.filter = newOptions.filter;
    }
    if (newOptions.sort !== undefined) {
      this.options.sort = newOptions.sort;
    }
  }

  /**
   * Get the collection instance
   */
  protected abstract getCollection(): RecordService<T>;

  toSnakeCase(str: string): string {
    return str
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Create a new entity
   */
  async create(input: InputType): Promise<T> {
    try {
      const data = await this.validateInput(input);
      const record = await this.entityCreate(data);
      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Update an existing entity
   */
  async update(id: string, input: Partial<T>): Promise<T> {
    try {
      const record = await this.entityUpdate(id, input);
      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Create or update entity (upsert)
   */
  async upsert(input: InputType & { id?: string }): Promise<T> {
    if (input?.id) {
      return await this.update(input.id, input as Partial<T>);
    }

    // Implementations should override this method if they need
    // more specific upsert logic like checking for existing entities
    return await this.create(input);
  }

  /**
   * Get entity by ID
   */
  async getById<E extends keyof Relations = never>(
    id: string,
    expand?: E | E[]
  ): Promise<Expanded<T, Relations, E> | null> {
    try {
      const record = await this.entityGetById(id, expand as string | string[]);
      return (await this.processRecord(record)) as Expanded<T, Relations, E>;
    } catch (error) {
      return this.handleError(error, { allowNotFound: true });
    }
  }

  /**
   * Get first entity by filter
   */
  async getFirstByFilter<E extends keyof Relations = never>(
    filter: string | string[],
    expand?: E | E[],
    sort?: string
  ): Promise<Expanded<T, Relations, E> | null> {
    try {
      const record = await this.entityGetFirstByFilter(
        filter,
        expand as string | string[],
        sort
      );
      return (await this.processRecord(record)) as Expanded<T, Relations, E>;
    } catch (error) {
      return this.handleError(error, { allowNotFound: true });
    }
  }

  /**
   * Get list of entities
   */
  async getList<E extends keyof Relations = never>(
    page = 1,
    perPage = 100,
    filter?: string | string[],
    sort?: string,
    expand?: E | E[]
  ): Promise<ListResult<Expanded<T, Relations, E>>> {
    try {
      const result = await this.entityGetList(
        page,
        perPage,
        filter,
        sort,
        expand as string | string[]
      );
      return (await this.processListResult(result)) as ListResult<
        Expanded<T, Relations, E>
      >;
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  /**
   * Delete entity by ID
   */
  async delete(id: string): Promise<boolean> {
    try {
      return await this.entityDelete(id);
    } catch (error) {
      return this.handleError(error, { returnValue: false });
    }
  }

  /**
   * Process a single record before returning it
   * Can be overridden to handle special cases like mapped entities
   */
  protected async processRecord(record: T): Promise<T> {
    return record;
  }

  /**
   * Process a list result before returning it
   * Can be overridden to handle special cases like mapped entities
   */
  protected async processListResult(
    result: ListResult<T>
  ): Promise<ListResult<T>> {
    // Process each item in the list
    const processedItems = await Promise.all(
      result.items.map((item) => this.processRecord(item))
    );

    return {
      ...result,
      items: processedItems,
    };
  }

  /**
   * Prepare expand parameter
   * Combines default expands with provided expands
   */
  protected prepareExpand(expand?: string | string[]): string | undefined {
    // Handle empty defaults case
    if (!this.options.expand.length && !expand) {
      return undefined;
    }

    // Convert all inputs to arrays for easy processing
    let expandArray: string[] = [...this.options.expand];

    if (expand) {
      // If expand is a string, split it and add the parts
      if (typeof expand === 'string') {
        expandArray = expandArray.concat(
          expand.split(',').map((e) => e.trim())
        );
      }
      // If expand is already an array, concatenate
      else {
        expandArray = expandArray.concat(expand);
      }
    }

    // Filter out duplicates, empty strings, and undefined values
    const uniqueExpands = [...new Set(expandArray)].filter(
      (e) => e !== '' && e !== undefined
    );

    // If no valid expands, return undefined
    if (!uniqueExpands.length) {
      return undefined;
    }

    // Join with comma and space
    return uniqueExpands.join(',');
  }

  /**
   * Prepare filter parameter
   * Combines default filters with provided filters
   */
  protected prepareFilter(filter?: string | string[]): string | undefined {
    // Handle empty case
    if (!this.options.filter.length && !filter) {
      return undefined;
    }

    // Convert all inputs to arrays for easy processing
    let filterArray: string[] = [...this.options.filter];

    if (filter) {
      // If filter is a string, add it as is (it might contain && already)
      if (typeof filter === 'string') {
        if (filter) filterArray.push(filter);
      }
      // If filter is an array, concatenate
      else {
        filterArray = filterArray.concat(filter);
      }
    }

    // Filter out empty strings and undefined values
    const validFilters = filterArray.filter((f) => f !== '' && f !== undefined);

    // If no valid filters, return undefined
    if (!validFilters.length) {
      return undefined;
    }

    // Join with AND operator
    return validFilters.join('&&');
  }

  /**
   * Prepare sort parameter
   * Uses provided sort or falls back to default sort
   */
  protected prepareSort(sort?: string): string | undefined {
    // If explicit sort is provided and not empty, use it (overriding defaults)
    if (sort && sort !== '') {
      return sort;
    }

    // If no explicit sort but we have defaults
    if (this.options.sort.length) {
      // Filter out empty and undefined values
      const validSorts = this.options.sort.filter(
        (s) => s !== '' && s !== undefined
      );

      // If we have valid sort items after filtering
      if (validSorts.length) {
        return validSorts.join(',');
      }
    }

    // No sort specified
    return undefined;
  }

  /**
   * Perform the actual create operation
   */
  protected async entityCreate(data: InputType): Promise<T> {
    const finalExpand = this.prepareExpand();
    const options: RecordOptions = finalExpand ? { expand: finalExpand } : {};
    return await this.getCollection().create(
      data as Record<string, unknown>,
      options
    );
  }

  /**
   * Perform the actual update operation
   */
  protected async entityUpdate(id: string, data: Partial<T>): Promise<T> {
    const finalExpand = this.prepareExpand();
    const options: RecordOptions = finalExpand ? { expand: finalExpand } : {};
    return await this.getCollection().update(id, data, options);
  }

  /**
   * Perform the actual getById operation
   */
  protected async entityGetById(
    id: string,
    expand?: string | string[]
  ): Promise<T> {
    const finalExpand = this.prepareExpand(expand);
    const options: RecordOptions = finalExpand ? { expand: finalExpand } : {};
    return await this.getCollection().getOne(id, options);
  }

  /**
   * Perform the actual getFirstByFilter operation
   */
  protected async entityGetFirstByFilter(
    filter: string | string[],
    expand?: string | string[],
    sort?: string
  ): Promise<T> {
    const finalFilter = this.prepareFilter(filter);
    const finalExpand = this.prepareExpand(expand);
    const finalSort = this.prepareSort(sort);

    const options: RecordListOptions = {};
    if (finalExpand) options.expand = finalExpand;
    if (finalSort) options.sort = finalSort;

    return await this.getCollection().getFirstListItem(
      finalFilter || '',
      options
    );
  }

  /**
   * Perform the actual getList operation
   * Returns a list result with items of type T
   */
  protected async entityGetList(
    page: number,
    perPage: number,
    filter?: string | string[],
    sort?: string,
    expand?: string | string[]
  ): Promise<ListResult<T>> {
    const finalFilter = this.prepareFilter(filter);
    const finalExpand = this.prepareExpand(expand);
    const finalSort = this.prepareSort(sort);

    const options: RecordListOptions = {};
    if (finalFilter) options.filter = finalFilter;
    if (finalExpand) options.expand = finalExpand;
    if (finalSort) options.sort = finalSort;

    return await this.getCollection().getList(page, perPage, options);
  }

  /**
   * Perform the actual delete operation
   */
  protected async entityDelete(id: string): Promise<boolean> {
    await this.getCollection().delete(id);
    return true;
  }

  /**
   * Error handler for common errors
   * @param error The error to handle
   * @param options Handler options
   * @returns The value to return if the error is handled, or throws if not handled
   */
  protected handleError<R>(
    error: unknown,
    options: {
      allowNotFound?: boolean;
      returnValue?: R;
      logError?: boolean;
    } = { logError: true }
  ): R {
    const { allowNotFound = false, returnValue, logError = true } = options;

    // Log the error if requested and it's not a silenced 404
    const isSilencedNotFound = allowNotFound && this.isNotFoundError(error);
    if (logError && !isSilencedNotFound) {
      console.error(`Error in ${this.constructor.name}:`, error);
    }

    // Handle 404 errors if allowed
    if (isSilencedNotFound) {
      return null as R;
    }

    // Return specified value or rethrow
    if (returnValue !== undefined) {
      return returnValue;
    }

    // Rethrow the error
    throw error;
  }

  /**
   * Check if an error is a "not found" error
   */
  protected isNotFoundError(error: unknown): boolean {
    if (!error) return false;

    // Check for PocketBase ClientResponseError status
    if (
      typeof error === 'object' &&
      'status' in error &&
      error.status === 404
    ) {
      return true;
    }

    return (
      error instanceof Error &&
      (error.message.includes('404') ||
        error.message.toLowerCase().includes('not found'))
    );
  }

  /**
   * Standard error handling wrapper (legacy method, consider using handleError instead)
   */

  protected errorWrapper(error: unknown): never {
    console.error(`Error in ${this.constructor.name}:`, error);
    throw error;
  }

  /**
   * Validate input data before creating/updating
   * Should be implemented by child classes
   */
  protected abstract validateInput(input: InputType): Promise<InputType>;

  /**
   * Subscribe to changes on a specific record
   * @param id The ID of the record to subscribe to
   * @param callback Function to call when changes occur
   * @param expand Optional expand parameters
   * @returns Promise that resolves to an unsubscribe function
   */
  async subscribeToRecord<E extends keyof Relations = never>(
    id: string,
    callback: (data: RecordSubscription<Expanded<T, Relations, E>>) => void,
    expand?: E | E[]
  ): Promise<UnsubscribeFunc> {
    const finalExpand = this.prepareExpand(expand as string | string[]);
    const options: RecordSubscribeOptions = finalExpand
      ? { expand: finalExpand }
      : {};

    return this.getCollection().subscribe(
      id,
      callback as (data: RecordSubscription<T>) => void,
      options
    );
  }

  /**
   * Subscribe to changes on the entire collection
   * @param callback Function to call when changes occur
   * @param expand Optional expand parameters
   * @returns Promise that resolves to an unsubscribe function
   */
  async subscribeToCollection<E extends keyof Relations = never>(
    callback: (data: RecordSubscription<Expanded<T, Relations, E>>) => void,
    expand?: E | E[]
  ): Promise<UnsubscribeFunc> {
    const finalExpand = this.prepareExpand(expand as string | string[]);
    const options: RecordSubscribeOptions = finalExpand
      ? { expand: finalExpand }
      : {};

    return this.getCollection().subscribe(
      '*',
      callback as (data: RecordSubscription<T>) => void,
      options
    );
  }

  /**
   * Unsubscribe from a specific record's changes
   * @param id The ID of the record to unsubscribe from
   */
  unsubscribeFromRecord(id: string): void {
    this.getCollection().unsubscribe(id);
  }

  /**
   * Unsubscribe from collection-wide changes
   */
  unsubscribeFromCollection(): void {
    this.getCollection().unsubscribe('*');
  }

  /**
   * Unsubscribe from all subscriptions in this collection
   */
  unsubscribeAll(): void {
    this.getCollection().unsubscribe();
  }
}
