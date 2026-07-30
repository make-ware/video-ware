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
    // Deterministic stand-in for the SDK's file URL builder.
    files: {
      getURL: (record: { id: string }, filename: string) =>
        `http://pb.test/api/files/Files/${record.id}/${filename}`,
    },
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

/**
 * A PocketBase `ListResult` envelope. `totalItems` defaults to the number of
 * items given (a single complete page); pass it explicitly — with `perPage` —
 * to describe one page of a larger result set, which is what the pagination
 * helpers need to exercise.
 */
export function listResult(
  items: any[],
  opts: { page?: number; perPage?: number; totalItems?: number } = {}
) {
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? Math.max(items.length, 1);
  const totalItems = opts.totalItems ?? items.length;
  return {
    page,
    perPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
    items,
  };
}
