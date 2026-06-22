import { Injectable, Logger } from '@nestjs/common';
import {
  FileStatus,
  TaskStatus,
  type CleanupResult,
  type Media,
  type Task,
} from '@project/shared';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { StorageService } from '../shared/services/storage.service';

// Single-relation Media fields that point at a derived File. filmstripFileRefs
// (a multi-relation) is handled separately.
const SINGLE_REF_FIELDS = [
  'proxyFileRef',
  'spriteFileRef',
  'thumbnailFileRef',
  'audioFileRef',
] as const;

const MEDIA_PAGE_SIZE = 500;
const FILE_PAGE_SIZE = 200;
const ARTIFACT_PAGE_SIZE = 200;

// FAILED files younger than this are left alone (a retry may still be in flight);
// also the staleness threshold for worker working directories. DELETED files are
// pruned regardless of age.
const GRACE_MS = 24 * 60 * 60 * 1000;

// Safety bound so a pathological backlog can't run unboundedly in one pass.
const MAX_ARTIFACTS_PER_RUN = 5000;

/**
 * CleanupOrchestratorService runs the scheduled `cleanup` Task. Like
 * IngestOrchestratorService it is an in-process orchestration task (no BullMQ
 * flow): it claims the task (queued -> running) and owns its own status, so the
 * generic enqueue/claim path is bypassed for it.
 *
 * Steps (in order — prune must precede drain so files deleted this run are reaped
 * this run via the files-artifact-tombstone hook):
 *   1. backfill missing Files.MediaRef links (legacy files),
 *   2. prune stale File records (soft-deleted, or failed past the grace window),
 *   3. drain the Artifacts queue (delete external blobs that outlived their File),
 *   4. reconcile the local storage tree — purge orphaned upload/transcode/label
 *      dirs (local backend only; folder-level, keyed on live PocketBase records),
 *   5. remove stale worker working directories (worker-temp + render working
 *      dirs, mtime based, every backend).
 *
 * Each step is best-effort and resilient: a failure in one does not block the
 * others. The task is only marked failed on an unexpected top-level error.
 */
@Injectable()
export class CleanupOrchestratorService {
  private readonly logger = new Logger(CleanupOrchestratorService.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {}

  async run(task: Task): Promise<void> {
    try {
      // Claim up front (queued -> running). cleanup is orchestrated in-process
      // with no BullMQ jobId dedup, and the poll loop selects tasks by
      // `status = queued`; marking it running drops it out of the queued set so
      // concurrent workers don't run it twice. Best-effort.
      try {
        await this.pocketbaseService.updateTask(task.id, {
          status: TaskStatus.RUNNING,
        });
      } catch (claimError) {
        this.logger.warn(
          `Failed to claim cleanup task ${task.id} (continuing): ${
            claimError instanceof Error
              ? claimError.message
              : String(claimError)
          }`
        );
      }

      const refsLinked = await this.backfillMediaRefs();
      await this.setProgress(task.id, 30);

      const staleFilesPruned = await this.pruneStaleFiles();
      await this.setProgress(task.id, 55);

      const { deleted: artifactsDeleted, failed: artifactsFailed } =
        await this.drainArtifacts();
      await this.setProgress(task.id, 65);

      const localDirsPurged = await this.reconcileLocalStorage();
      await this.setProgress(task.id, 85);

      const tempDirsRemoved =
        await this.storageService.cleanupStaleWorkingDirs(GRACE_MS);

      const result: CleanupResult = {
        refsLinked,
        staleFilesPruned,
        artifactsDeleted,
        artifactsFailed,
        localDirsPurged,
        tempDirsRemoved,
      };

      await this.pocketbaseService.taskMutator.markSuccess(
        task.id,
        result as unknown as Record<string, unknown>
      );

      this.logger.log(
        `Cleanup task ${task.id} done: ${JSON.stringify(result)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cleanup task ${task.id} failed: ${message}`);
      try {
        await this.pocketbaseService.taskMutator.markFailed(task.id, message);
      } catch {
        // Best-effort; the next scheduled run will retry.
      }
    }
  }

  /**
   * Step 1 — Link legacy Files to their Media via Files.MediaRef. New files set
   * MediaRef at creation; this walks each Media's relation fields and points any
   * still-unlinked File back at the Media so cascadeDelete will cover it.
   * Idempotent. We only modify Files (never Media), so offset paging is stable.
   */
  private async backfillMediaRefs(): Promise<number> {
    let linked = 0;
    try {
      let page = 1;

      while (true) {
        const result = await this.pocketbaseService.mediaMutator.getList(
          page,
          MEDIA_PAGE_SIZE
        );
        const mediaItems = result.items as Media[];
        if (mediaItems.length === 0) break;

        for (const media of mediaItems) {
          for (const field of SINGLE_REF_FIELDS) {
            const fileId = media[field as keyof Media] as string | undefined;
            linked += await this.linkFile(fileId, media.id);
          }
          const strips =
            (media.filmstripFileRefs as unknown as string[] | undefined) ?? [];
          for (const fileId of strips) {
            linked += await this.linkFile(fileId, media.id);
          }
        }

        if (mediaItems.length < MEDIA_PAGE_SIZE) break;
        page += 1;
      }
    } catch (error) {
      this.logger.warn(
        `backfillMediaRefs failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return linked;
  }

  /** Link a single File -> Media if not already linked. Returns 1 if it wrote. */
  private async linkFile(
    fileId: string | undefined,
    mediaId: string
  ): Promise<number> {
    if (!fileId) return 0;
    try {
      const file = await this.pocketbaseService.fileMutator.getById(fileId);
      if (!file) return 0; // already gone
      if (file.MediaRef) return 0; // already linked
      await this.pocketbaseService.fileMutator.update(fileId, {
        MediaRef: mediaId,
      } as Partial<typeof file>);
      return 1;
    } catch {
      return 0;
    }
  }

  /**
   * Step 2 — Delete stale File records. Deleting a record fires the
   * files-artifact-tombstone hook, which queues the external blob (if any) into
   * Artifacts for step 3. Prunes DELETED files unconditionally and FAILED files
   * older than the grace window.
   */
  private async pruneStaleFiles(): Promise<number> {
    let pruned = 0;
    const cutoffIso = new Date(Date.now() - GRACE_MS).toISOString();
    try {
      // The set shrinks as we delete, so always read page 1. Stop when a page
      // yields no successful deletions to avoid looping on undeletable rows.

      while (true) {
        const filter = this.pocketbaseService
          .getClient()
          .filter(
            'fileStatus = {:deleted} || (fileStatus = {:failed} && created < {:cutoff})',
            {
              deleted: FileStatus.DELETED,
              failed: FileStatus.FAILED,
              cutoff: cutoffIso,
            }
          );

        const result = await this.pocketbaseService.fileMutator.getList(
          1,
          FILE_PAGE_SIZE,
          filter,
          'created'
        );
        if (result.items.length === 0) break;

        let deletedThisPage = 0;
        for (const file of result.items) {
          const ok = await this.pocketbaseService.deleteFile(file.id);
          if (ok) {
            pruned += 1;
            deletedThisPage += 1;
          }
        }

        if (deletedThisPage === 0) break; // nothing deletable -> avoid infinite loop
      }
    } catch (error) {
      this.logger.warn(
        `pruneStaleFiles failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return pruned;
  }

  /**
   * Step 3 — Drain the Artifacts queue: delete each pending blob from storage,
   * then remove the row. A blob that is already gone counts as deleted
   * (idempotent). Real failures bump the attempt counter and flip the row to
   * `failed` (which removes it from the pending set, so the loop terminates).
   */
  private async drainArtifacts(): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    let processed = 0;
    try {
      while (true) {
        const result =
          await this.pocketbaseService.artifactMutator.getPending(
            ARTIFACT_PAGE_SIZE
          );
        if (result.items.length === 0) break;

        for (const artifact of result.items) {
          if (processed >= MAX_ARTIFACTS_PER_RUN) {
            this.logger.warn(
              `drainArtifacts: hit per-run cap (${MAX_ARTIFACTS_PER_RUN}); ${
                result.totalItems - processed
              } artifact(s) deferred to next run`
            );
            return { deleted, failed };
          }
          processed += 1;

          const reaped = await this.reapArtifact(
            artifact.id,
            artifact.storageKey,
            artifact.attempts ?? 0
          );
          if (reaped) deleted += 1;
          else failed += 1;
        }
      }
    } catch (error) {
      this.logger.warn(
        `drainArtifacts failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return { deleted, failed };
  }

  /** Delete one artifact's blob + row. Returns true on success (or already-gone). */
  private async reapArtifact(
    id: string,
    storageKey: string,
    attempts: number
  ): Promise<boolean> {
    try {
      await this.storageService.delete(storageKey);
      await this.pocketbaseService.artifactMutator.delete(id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isNotFound(message)) {
        // Blob already gone -> the tombstone has done its job.
        await this.pocketbaseService.artifactMutator.delete(id);
        return true;
      }
      try {
        await this.pocketbaseService.artifactMutator.markFailed(
          id,
          message,
          attempts
        );
      } catch {
        // best-effort
      }
      return false;
    }
  }

  /**
   * Step 4 — Purge orphaned directories from the local storage tree. Builds the
   * keep-sets from live PocketBase records and delegates the folder-level sweep
   * (and the local-backend guard + grace window) to StorageService.reconcileLocal.
   * Render working dirs are not handled here — they're reclaimed by the mtime
   * based stale-dir sweep in step 5.
   */
  private async reconcileLocalStorage(): Promise<number> {
    try {
      const { uploadIds, mediaIds } = await this.collectMediaSets();
      return await this.storageService.reconcileLocal(
        { uploadIds, mediaIds },
        GRACE_MS
      );
    } catch (error) {
      this.logger.warn(
        `reconcileLocalStorage failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 0;
    }
  }

  /**
   * Live Media ids, and the set of upload ids that have a Media. An upload dir
   * with no Media is treated as a dead/incomplete ingest and is purgeable.
   */
  private async collectMediaSets(): Promise<{
    uploadIds: Set<string>;
    mediaIds: Set<string>;
  }> {
    const uploadIds = new Set<string>();
    const mediaIds = new Set<string>();
    let page = 1;
    while (true) {
      const result = await this.pocketbaseService.mediaMutator.getList(
        page,
        MEDIA_PAGE_SIZE
      );
      const items = result.items as Media[];
      if (items.length === 0) break;
      for (const media of items) {
        mediaIds.add(media.id);
        const uploadRef = media.UploadRef as string | undefined;
        if (uploadRef) uploadIds.add(uploadRef);
      }
      if (items.length < MEDIA_PAGE_SIZE) break;
      page += 1;
    }
    return { uploadIds, mediaIds };
  }

  private isNotFound(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes('enoent') ||
      m.includes('not found') ||
      m.includes('nosuchkey') ||
      m.includes('404')
    );
  }

  private async setProgress(taskId: string, progress: number): Promise<void> {
    try {
      await this.pocketbaseService.updateTask(taskId, { progress });
    } catch {
      // Progress is advisory; ignore failures.
    }
  }
}
