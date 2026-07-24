import { RecordService } from 'pocketbase';
import { WatchFolderImportInputSchema } from '../schema';
import type { WatchFolderImport, WatchFolderImportInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { WatchFolderImportStatus } from '../enums';
import { BaseMutator, type MutatorOptions } from './base';

/** Canonical in-memory identity for a ledger pair ('\n' can't occur in keys). */
export function watchFolderPairKey(key: string, etag: string): string {
  return `${key}\n${etag}`;
}

/** Pairs per filter request in findBurnedPairs (each pair = 2 bound params). */
const BURNED_LOOKUP_CHUNK = 20;

/**
 * Ledger of attempted S3 watch-folder imports. A row existing for a
 * (key, etag) pair — any status — burns the pair: the watcher never
 * reattempts it. The DB unique index on (key, etag) makes `claim` the
 * atomic arbiter between concurrent workers.
 */
export class WatchFolderImportMutator extends BaseMutator<
  WatchFolderImport,
  WatchFolderImportInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<WatchFolderImport> {
    return this.pb.collection('WatchFolderImports');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: WatchFolderImportInput
  ): Promise<WatchFolderImportInput> {
    return WatchFolderImportInputSchema.parse(input);
  }

  /**
   * Atomically claim a (key, etag) pair by creating its ledger row with
   * status `importing`. Returns null when the pair is already burned (a row
   * exists — either we lost a race or a prior attempt was recorded).
   *
   * Bypasses BaseMutator.create so an expected unique-index rejection isn't
   * logged as an error.
   */
  async claim(
    input: Omit<WatchFolderImportInput, 'status'>
  ): Promise<WatchFolderImport | null> {
    const data = await this.validateInput({
      ...input,
      status: WatchFolderImportStatus.IMPORTING,
    });
    try {
      return await this.getCollection().create(data as Record<string, unknown>);
    } catch (error) {
      const existing = await this.getFirstByFilter(
        this.pb.filter('key = {:key} && etag = {:etag}', {
          key: input.key,
          etag: input.etag,
        })
      );
      if (existing) return null; // burned: lost the race or previously attempted
      throw error;
    }
  }

  /**
   * Burn a (key, etag) pair without attempting an import (unsupported
   * extension, invalid layout, …). Race-tolerant like `claim`: an existing
   * row means the pair is already burned, which is the desired end state.
   */
  async skip(
    input: Omit<WatchFolderImportInput, 'status' | 'error'>,
    reason: string
  ): Promise<WatchFolderImport | null> {
    const data = await this.validateInput({
      ...input,
      status: WatchFolderImportStatus.SKIPPED,
      error: truncateError(reason),
    });
    try {
      return await this.getCollection().create(data as Record<string, unknown>);
    } catch (error) {
      const existing = await this.getFirstByFilter(
        this.pb.filter('key = {:key} && etag = {:etag}', {
          key: input.key,
          etag: input.etag,
        })
      );
      if (existing) return null;
      throw error;
    }
  }

  /**
   * Which of the given (key, etag) pairs already have ledger rows.
   * Queries in chunks with bound params (keys may contain quotes/spaces).
   * Returns a Set of `watchFolderPairKey` identities.
   */
  async findBurnedPairs(
    pairs: Array<{ key: string; etag: string }>
  ): Promise<Set<string>> {
    const burned = new Set<string>();
    for (let i = 0; i < pairs.length; i += BURNED_LOOKUP_CHUNK) {
      const chunk = pairs.slice(i, i + BURNED_LOOKUP_CHUNK);
      const params: Record<string, string> = {};
      const clauses = chunk.map((pair, j) => {
        params[`k${j}`] = pair.key;
        params[`e${j}`] = pair.etag;
        return `(key = {:k${j}} && etag = {:e${j}})`;
      });
      const result = await this.getList(
        1,
        chunk.length,
        this.pb.filter(clauses.join(' || '), params)
      );
      for (const row of result.items) {
        burned.add(watchFolderPairKey(row.key, row.etag));
      }
    }
    return burned;
  }

  /** Record a successful handoff into the upload pipeline. */
  async markImported(id: string, uploadId: string): Promise<WatchFolderImport> {
    return this.update(id, {
      status: WatchFolderImportStatus.IMPORTED,
      UploadRef: uploadId,
    } as Partial<WatchFolderImport>);
  }

  /** Record a failed attempt (the pair stays burned). */
  async markFailed(id: string, error: string): Promise<WatchFolderImport> {
    return this.update(id, {
      status: WatchFolderImportStatus.FAILED,
      error: truncateError(error),
    } as Partial<WatchFolderImport>);
  }
}

function truncateError(message: string): string {
  return message.length > 500 ? message.substring(0, 497) + '...' : message;
}
