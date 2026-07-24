import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  StorageBackendType,
  UploadStatus,
  watchFolderPairKey,
  type Upload,
  type WatchFolderImport,
} from '@project/shared';
import { generateStoragePath } from '@project/shared/storage';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { StorageService } from '../shared/services/storage.service';
import {
  planTick,
  type BurnSkip,
  type ImportCandidate,
} from './watch-folder.util';

/** Attempts for the post-move Upload finalize write (the hook trigger). */
const FINALIZE_ATTEMPTS = 3;
const FINALIZE_RETRY_DELAY_MS = 500;

/** Resolved workspace context a candidate imports under. */
interface WorkspaceContext {
  workspaceId: string;
  /** Oldest workspace member (the creator) — becomes Upload.UserRef. */
  userId: string;
}

/**
 * S3-only import-folder watcher. Polls `{prefix}` for settled objects laid
 * out as `{prefix}{workspaceId}/[{dir}/]{file}`, claims each in the
 * WatchFolderImports ledger (the unique (key, etag) index arbitrates
 * concurrent workers), moves the object into the standard
 * `uploads/{ws}/{uploadId}/original.{ext}` layout, and finalizes an Upload
 * record to `uploaded` — the existing uploads hook then creates the
 * `full_ingest` task and the normal pipeline takes over.
 *
 * Contract highlights:
 * - A (key, etag) pair is burned the moment an attempt or a structural
 *   reject is recorded — success, failure, or skip, it is never retried.
 *   Renaming/moving the object mints a fresh pair.
 * - Objects are never touched inside the quiet period after LastModified.
 * - On failure the object stays in the import folder (only the ledger row
 *   records the attempt); on success it is moved out.
 * - Unknown workspace segments are left untouched AND unburned — the
 *   workspace may be created later, at which point pending files import.
 * - Objects larger than 5 GB fail the server-side CopyObject and land in
 *   the failed-import path (multipart copy is a future enhancement).
 */
@Injectable()
export class WatchFolderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WatchFolderService.name);
  private isPolling = false;
  private _lastPollTs?: number;
  /**
   * (key, etag) pairs known burned — a cache over the ledger's unique
   * index, never a source of truth. Empty after a restart; the first tick
   * repopulates it from the ledger via findBurnedPairs.
   */
  private readonly burnedCache = new Set<string>();
  /** Workspace segments already warned about (unknown/memberless). */
  private readonly warnedSegments = new Set<string>();
  /** Set when a hard precondition fails (non-S3 backend); silences ticks. */
  private disabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {}

  onApplicationBootstrap() {
    if (!this.isEnabled()) {
      this.logger.debug(
        'Watch folder importer is disabled (ENABLE_WATCH_FOLDER!=true)'
      );
      return;
    }

    this.logger.log(
      `Watch folder importer enabled: watching '${this.getPrefix()}' ` +
        `(quiet period ${this.getQuietPeriodMs()}ms, poll ${this.getPollIntervalMs()}ms)`
    );

    // Kick one poll immediately so we don't wait for the first interval tick.
    void this.pollOnce();
  }

  @Interval('watch-folder', 10000)
  async pollIntervalTick() {
    if (!this.isEnabled()) return;
    await this.pollOnce();
  }

  private isEnabled(): boolean {
    return (
      this.configService.get<boolean>('watchFolder.enabled', false) &&
      !this.disabled
    );
  }

  private getPrefix(): string {
    return this.configService.get<string>('watchFolder.prefix', 'import/');
  }

  private getQuietPeriodMs(): number {
    return this.configService.get<number>('watchFolder.quietPeriodMs', 900000);
  }

  private getPollIntervalMs(): number {
    return this.configService.get<number>('watchFolder.pollIntervalMs', 60000);
  }

  private async pollOnce(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      // PocketBaseService connects/initializes mutators on startup. If it's
      // not ready yet, skip.
      if (!this.pocketbaseService.watchFolderImportMutator) {
        this.logger.debug(
          'PocketBase mutators not ready yet; skipping watch-folder poll'
        );
        return;
      }
      if (!this.checkBackend()) return;

      // Keep the Nest schedule interval fixed; allow runtime-configured
      // pacing here (mirrors TaskEnqueuerService).
      const pollInterval = this.getPollIntervalMs();
      if (pollInterval > 10000) {
        const now = Date.now();
        const last = this._lastPollTs;
        if (last && now - last < pollInterval) return;
        this._lastPollTs = now;
      }

      const prefix = this.getPrefix();
      const files = await this.storageService.listFiles(prefix);
      const plan = planTick(files, {
        prefix,
        quietPeriodMs: this.getQuietPeriodMs(),
        now: Date.now(),
      });

      for (const skip of plan.silentSkips) {
        this.logger.debug(
          `Watch folder: leaving '${skip.key}' alone (${skip.reason})`
        );
      }

      // Drop everything already burned: first via the in-memory cache, then
      // via one chunked ledger lookup for pairs the cache doesn't know.
      const unknownPairs = [...plan.candidates, ...plan.burnSkips].filter(
        (item) => !this.burnedCache.has(watchFolderPairKey(item.key, item.etag))
      );
      if (unknownPairs.length > 0) {
        const burned =
          await this.pocketbaseService.watchFolderImportMutator.findBurnedPairs(
            unknownPairs.map(({ key, etag }) => ({ key, etag }))
          );
        for (const pair of burned) this.burnedCache.add(pair);
      }
      const isBurned = (item: { key: string; etag: string }) =>
        this.burnedCache.has(watchFolderPairKey(item.key, item.etag));

      // Per-tick workspace caches only: a deleted workspace must stop
      // importing by the next tick.
      const contexts = new Map<string, WorkspaceContext | null>();
      const directories = new Map<string, string>();

      let imported = 0;
      let failed = 0;
      let burned = 0;

      for (const skip of plan.burnSkips.filter((s) => !isBurned(s))) {
        if (await this.burnSkip(skip, contexts)) burned++;
      }

      for (const candidate of plan.candidates.filter((c) => !isBurned(c))) {
        const context = await this.resolveWorkspace(
          candidate.workspaceId,
          contexts
        );
        if (!context) continue; // unknown workspace: untouched, unburned

        const outcome = await this.importOne(candidate, context, directories);
        if (outcome === 'imported') imported++;
        else if (outcome === 'failed') failed++;
      }

      if (imported + failed + burned > 0) {
        this.logger.log(
          `Watch folder: imported ${imported}, failed ${failed}, ` +
            `burned ${burned} skip(s)`
        );
      }
    } catch (error) {
      this.logger.error(
        `Watch folder poll failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * The watcher is S3-only: local deployments have no drop bucket, and the
   * import flow relies on server-side CopyObject semantics. A non-S3
   * backend disables the service for the process lifetime.
   */
  private checkBackend(): boolean {
    const backend = this.storageService.getBackend();
    if (!backend) {
      this.logger.debug('Storage backend not ready yet; skipping poll');
      return false;
    }
    if (backend.type !== StorageBackendType.S3) {
      this.logger.log(
        `Watch folder importer disabled: requires S3 storage ` +
          `(backend is '${backend.type}')`
      );
      this.disabled = true;
      return false;
    }
    return true;
  }

  /**
   * Resolve the workspace behind a path segment and the user imports are
   * attributed to (the oldest member — the creator). Returns null (and
   * warns once per segment) when either is missing; those files stay
   * untouched and unburned so they import once the workspace exists.
   */
  private async resolveWorkspace(
    workspaceId: string,
    cache: Map<string, WorkspaceContext | null>
  ): Promise<WorkspaceContext | null> {
    if (cache.has(workspaceId)) return cache.get(workspaceId) ?? null;

    let context: WorkspaceContext | null = null;
    const workspace =
      await this.pocketbaseService.workspaceMutator.getById(workspaceId);
    if (!workspace) {
      this.warnSegmentOnce(
        workspaceId,
        `Watch folder: unknown workspace '${workspaceId}' — leaving its files untouched`
      );
    } else {
      const oldestMember =
        await this.pocketbaseService.workspaceMemberMutator.getFirstByFilter(
          `WorkspaceRef = "${workspaceId}"`,
          undefined,
          'created'
        );
      if (!oldestMember) {
        this.warnSegmentOnce(
          workspaceId,
          `Watch folder: workspace '${workspaceId}' has no members — leaving its files untouched`
        );
      } else {
        context = { workspaceId, userId: oldestMember.UserRef as string };
      }
    }

    cache.set(workspaceId, context);
    return context;
  }

  private warnSegmentOnce(segment: string, message: string): void {
    if (this.warnedSegments.has(segment)) {
      this.logger.debug(message);
      return;
    }
    this.warnedSegments.add(segment);
    this.logger.warn(message);
  }

  /**
   * Burn a structural reject into the ledger. Rejects with a workspace
   * segment only burn when the workspace resolves — an unknown workspace
   * always wins (skip, don't burn), so a folder dropped before its
   * workspace exists never has its contents burned by other rules.
   */
  private async burnSkip(
    skip: BurnSkip,
    contexts: Map<string, WorkspaceContext | null>
  ): Promise<boolean> {
    let workspaceRef: string | undefined;
    if (skip.workspaceId) {
      const context = await this.resolveWorkspace(skip.workspaceId, contexts);
      if (!context) return false;
      workspaceRef = context.workspaceId;
    }

    try {
      await this.pocketbaseService.watchFolderImportMutator.skip(
        {
          key: skip.key,
          etag: skip.etag,
          size: skip.size,
          ...(workspaceRef ? { WorkspaceRef: workspaceRef } : {}),
        },
        skip.detail
      );
      this.burnedCache.add(watchFolderPairKey(skip.key, skip.etag));
      this.logger.debug(
        `Watch folder: burned '${skip.key}' (${skip.reason}: ${skip.detail})`
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Watch folder: failed to record skip for '${skip.key}': ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Import one settled object. Ordering is the crash-safety contract:
   * the ledger claim happens before any side effect, so the pair is burned
   * from the first moment an attempt exists — a crash anywhere below
   * leaves a row in `importing` and the object in place, never a retry.
   */
  private async importOne(
    candidate: ImportCandidate,
    context: WorkspaceContext,
    directories: Map<string, string>
  ): Promise<'imported' | 'failed' | 'skipped'> {
    const pair = watchFolderPairKey(candidate.key, candidate.etag);

    const row = await this.pocketbaseService.watchFolderImportMutator.claim({
      key: candidate.key,
      etag: candidate.etag,
      size: candidate.size,
      WorkspaceRef: context.workspaceId,
    });
    if (!row) {
      // Lost a race with another worker (or the pair got burned since the
      // lookup) — either way it's handled.
      this.burnedCache.add(pair);
      this.logger.debug(
        `Watch folder: '${candidate.key}' already claimed; skipping`
      );
      return 'skipped';
    }
    this.burnedCache.add(pair);

    let upload: Upload | undefined;
    try {
      const directoryId = candidate.directoryName
        ? await this.ensureDirectory(
            context.workspaceId,
            candidate.directoryName,
            directories
          )
        : undefined;

      upload = await this.pocketbaseService.uploadMutator.create({
        name: candidate.basename,
        size: candidate.size,
        status: UploadStatus.QUEUED,
        WorkspaceRef: context.workspaceId,
        UserRef: context.userId,
        ...(directoryId ? { DirectoryRef: directoryId } : {}),
      });

      const destination = generateStoragePath(
        context.workspaceId,
        upload.id,
        candidate.extension
      );

      // Server-side CopyObject + best-effort source delete. If the copy
      // fails the object stays in the import folder; if only the delete
      // fails a stray (already-burned) source object remains — harmless.
      await this.storageService.getBackend().move(candidate.key, destination);

      // The transition into `uploaded` is what fires the ingest hook, so
      // retry it: the object has already left the import folder, and giving
      // up here strands a moved blob behind a `queued` Upload.
      await this.finalizeUpload(upload.id, candidate, destination);

      try {
        await this.pocketbaseService.watchFolderImportMutator.markImported(
          row.id,
          upload.id
        );
      } catch (error) {
        // The import itself succeeded (hook fired); the row just stays in
        // `importing`, which is burned either way.
        this.logger.warn(
          `Watch folder: imported '${candidate.key}' but could not update ` +
            `its ledger row: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      this.logger.debug(
        `Watch folder: imported '${candidate.key}' as upload ${upload.id}`
      );
      return 'imported';
    } catch (error) {
      await this.failImport(candidate, row, upload, error);
      return 'failed';
    }
  }

  /** Flip the Upload to `uploaded` (the hook trigger), with retries. */
  private async finalizeUpload(
    uploadId: string,
    candidate: ImportCandidate,
    destination: string
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= FINALIZE_ATTEMPTS; attempt++) {
      try {
        await this.pocketbaseService.uploadMutator.update(uploadId, {
          status: UploadStatus.UPLOADED,
          storageBackend: StorageBackendType.S3,
          externalPath: destination,
          // Same flat metadata shape the webapp finalize path writes.
          storageConfig: {
            type: StorageBackendType.S3,
            bucket: this.configService.get<string>('storage.s3Bucket'),
            region: this.configService.get<string>('storage.s3Region'),
            endpoint: this.configService.get<string>('storage.s3Endpoint'),
          },
          bytesUploaded: candidate.size,
        } as Partial<Upload>);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < FINALIZE_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, FINALIZE_RETRY_DELAY_MS * attempt)
          );
        }
      }
    }
    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`moved to ${destination} but finalize failed: ${message}`);
  }

  /**
   * Record a failed attempt. The pair stays burned (the ledger row exists),
   * the object stays wherever the failure left it, and the Upload (if one
   * was created) is flipped to `failed` so it never triggers ingest.
   */
  private async failImport(
    candidate: ImportCandidate,
    row: WatchFolderImport,
    upload: Upload | undefined,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Watch folder: import of '${candidate.key}' failed: ${message}`
    );

    if (upload) {
      try {
        await this.pocketbaseService.uploadMutator.updateStatus(
          upload.id,
          UploadStatus.FAILED,
          message.slice(0, 500)
        );
      } catch {
        // best-effort
      }
    }

    try {
      await this.pocketbaseService.watchFolderImportMutator.markFailed(
        row.id,
        message
      );
    } catch (ledgerError) {
      this.logger.warn(
        `Watch folder: failed to record failure for '${candidate.key}': ` +
          `${ledgerError instanceof Error ? ledgerError.message : String(ledgerError)}`
      );
    }
  }

  /**
   * Find-or-create the Directory an import files under. Matching is
   * case-insensitive in JS because the DB unique index is COLLATE NOCASE
   * while PB's '=' filter is case-sensitive; a create that loses a unique
   * race falls back to re-fetching the winner.
   */
  private async ensureDirectory(
    workspaceId: string,
    name: string,
    cache: Map<string, string>
  ): Promise<string> {
    const cacheKey = `${workspaceId}\n${name.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const findExisting = async (): Promise<string | null> => {
      let page = 1;
      for (;;) {
        const result =
          await this.pocketbaseService.directoryMutator.getByWorkspace(
            workspaceId,
            page,
            500
          );
        const match = result.items.find(
          (dir) => dir.name.toLowerCase() === name.toLowerCase()
        );
        if (match) return match.id;
        if (page >= result.totalPages) return null;
        page++;
      }
    };

    let directoryId = await findExisting();
    if (!directoryId) {
      try {
        const created = await this.pocketbaseService.directoryMutator.create({
          WorkspaceRef: workspaceId,
          name,
        });
        directoryId = created.id;
      } catch (error) {
        // Unique-index race with another creator: the winner's row is the
        // directory we wanted.
        directoryId = await findExisting();
        if (!directoryId) throw error;
      }
    }

    cache.set(cacheKey, directoryId);
    return directoryId;
  }
}
