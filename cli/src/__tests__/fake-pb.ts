import type { TypedPocketBase } from '@project/shared';

export type Stub = Record<string, any>;

/**
 * Minimal PocketBase stand-in for lib-helper tests: collections are keyed by
 * PocketBase collection name and hold vi.fn() stubs for the record-service
 * methods a test exercises (getOne/getList/create/...).
 */
export function fakePb(collections: Record<string, Stub>): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    // Echo a deterministic, already-substituted filter string for assertions.
    filter: (tpl: string, params: Record<string, unknown>) =>
      Object.entries(params).reduce(
        (acc, [k, v]) => acc.replaceAll(`{:${k}}`, String(v)),
        tpl
      ),
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection: ${name}`);
      return c;
    },
  } as unknown as TypedPocketBase;
}

export function listResult(items: any[]) {
  return {
    page: 1,
    perPage: 200,
    totalItems: items.length,
    totalPages: 1,
    items,
  };
}
