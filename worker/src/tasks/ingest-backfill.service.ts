import { Injectable, Logger } from '@nestjs/common';
import {
  INGEST_ASSET_STEPS,
  INGEST_BASELINE_VERSION,
  MediaType,
  ProcessingProvider,
  TaskOrigin,
  TaskStatus,
  TaskType,
  pickIngestTranscodeConfig,
  planIngestBackfill,
  type File,
  type IngestAssetState,
  type IngestAssetStep,
  type IngestBackfillResult,
  type Media,
  type MediaRelations,
  type ProcessUploadPayload,
  type Task,
  type Upload,
} from '@project/shared';
import { TranscodeStepType } from '@project/shared/jobs';
import { PocketBaseService } from '../shared/services/pocketbase.service';

const MEDIA_PAGE_SIZE = 100;

/**
 * Media younger than this are left alone: their ingest may still be in flight
 * (the transcode flow's steps land minutes apart), and a backfill that raced it
 * would queue a duplicate encode of every asset that hasn't been written yet.
 */
const MEDIA_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Per-run ceiling on queued tasks. The backfill exists to close gaps steadily,
 * not to bury the transcode queue: the first run after a version bump would
 * otherwise re-encode an entire library in one go. Whatever is left over is
 * reported as `deferred` and picked up by the next weekly run.
 */
const MAX_TASKS_PER_RUN = 250;

/** Safety bound on how much of the library one run walks. */
const MAX_MEDIA_PER_RUN = 20000;

/**
 * A media whose last `MAX_RECENT_FAILURES` transcode tasks (within the lookback
 * window) all failed is left alone. Without this a permanently unprocessable
 * media — original blob gone, corrupt container — would be re-queued every
 * single week forever.
 */
const MAX_RECENT_FAILURES = 3;
const FAILURE_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/** Recent transcode tasks inspected per media (>= MAX_RECENT_FAILURES). */
const TASK_HISTORY_PAGE_SIZE = 10;

/** The Media relations a backfill decision reads. */
const MEDIA_EXPAND: (keyof MediaRelations)[] = [
  'UploadRef',
  'thumbnailFileRef',
  'spriteFileRef',
  'filmstripFileRefs',
  'waveformFileRefs',
  'proxyFileRef',
  'audioFileRef',
] as const;

/** Media relation holding the File(s) each asset step produces. */
const STEP_RELATION: Record<
  IngestAssetStep,
  keyof Pick<
    Media,
    | 'thumbnailFileRef'
    | 'spriteFileRef'
    | 'filmstripFileRefs'
    | 'waveformFileRefs'
    | 'proxyFileRef'
    | 'audioFileRef'
  >
> = {
  [TranscodeStepType.THUMBNAIL]: 'thumbnailFileRef',
  [TranscodeStepType.SPRITE]: 'spriteFileRef',
  [TranscodeStepType.FILMSTRIP]: 'filmstripFileRefs',
  [TranscodeStepType.WAVEFORM]: 'waveformFileRefs',
  [TranscodeStepType.TRANSCODE]: 'proxyFileRef',
  [TranscodeStepType.AUDIO]: 'audioFileRef',
};

/**
 * PocketBase omits `expand` entirely for unset relations, so every field here
 * is optional regardless of what the mutator's `Expanded<>` type promises.
 */
type MediaWithFiles = Media & {
  expand?: Partial<{
    UploadRef: Upload;
    thumbnailFileRef: File;
    spriteFileRef: File;
    filmstripFileRefs: File[];
    waveformFileRefs: File[];
    proxyFileRef: File;
    audioFileRef: File;
  }>;
};

/**
 * IngestBackfillService runs the scheduled `ingest_backfill` Task. Like the
 * cleanup and ingest orchestrators it is an in-process orchestration task (no
 * BullMQ flow): it claims the task (queued -> running) and owns its own status,
 * so the generic enqueue/claim path is bypassed for it.
 *
 * It walks the Media library and, for each record, compares the assets a fresh
 * ingest would produce (the shared ingest spec) against what the media actually
 * holds. Two things put a media in scope:
 *
 *   1. **Missing** — no File for a step the media type expects. This is the
 *      "media ingested before waveforms existed" case, and it covers every
 *      future step added to ingest for free.
 *   2. **Outdated** — a File stamped with an ingest version older than the
 *      current one (`File.meta.ingestVersion` vs `INGEST_STEP_VERSIONS`). Bump
 *      a step's version when its spec changes — a new proxy codec, say — and
 *      the library rolls forward one weekly batch at a time.
 *
 * For each such media it queues a `process_upload` task carrying ONLY the
 * steps that are actually owed, so a media missing just its waveform doesn't
 * re-encode its proxy. The tasks are left `queued`; the normal enqueue poll
 * loop paces them into BullMQ.
 *
 * Guards, in the order they apply: media younger than MEDIA_MIN_AGE_MS are not
 * scanned at all (ingest may still be running), media with a transcode task
 * already queued/running are skipped, and media whose recent transcode history
 * is all failures are abandoned rather than retried forever.
 *
 * Known limitation: a step that SUCCEEDS while legitimately producing no File
 * (rather than failing) leaves the asset missing, so that media is re-queued on
 * every run. The self-skipping steps are all audio-derived and are covered by
 * the `hasAudio` gate in the shared spec; if a new step gains a silent-skip
 * path, teach `expectedIngestSteps` about the condition rather than relying on
 * the failure guard, which only counts failures.
 */
@Injectable()
export class IngestBackfillService {
  private readonly logger = new Logger(IngestBackfillService.name);

  constructor(private readonly pocketbaseService: PocketBaseService) {}

  async run(task: Task): Promise<void> {
    try {
      // Claim up front (queued -> running). No BullMQ jobId dedup applies to
      // an in-process task and the poll loop selects on `status = queued`, so
      // marking it running is what stops a second worker running it too.
      // Best-effort: if this write fails the sweep below would fail too.
      try {
        await this.pocketbaseService.updateTask(task.id, {
          status: TaskStatus.RUNNING,
        });
      } catch (claimError) {
        this.logger.warn(
          `Failed to claim ingest_backfill task ${task.id} (continuing): ${
            claimError instanceof Error
              ? claimError.message
              : String(claimError)
          }`
        );
      }

      const result = await this.sweep(task.id);

      await this.pocketbaseService.taskMutator.markSuccess(
        task.id,
        result as unknown as Record<string, unknown>
      );

      this.logger.log(
        `Ingest backfill task ${task.id} done: ${JSON.stringify(result)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ingest backfill task ${task.id} failed: ${message}`);
      try {
        await this.pocketbaseService.taskMutator.markFailed(task.id, message);
      } catch {
        // Best-effort; the next scheduled run will retry.
      }
    }
  }

  /**
   * Walk the library and queue the missing work. Media pages are read oldest
   * first: this only ever creates Tasks (it never writes Media), so offset
   * paging stays stable for the whole sweep.
   */
  private async sweep(taskId: string): Promise<IngestBackfillResult> {
    const result: IngestBackfillResult = {
      mediaScanned: 0,
      mediaNeedingWork: 0,
      tasksCreated: 0,
      stepCounts: {},
      skippedInFlight: 0,
      skippedFailing: 0,
      skippedUnresolvable: 0,
      deferred: 0,
    };

    const cutoff = new Date(Date.now() - MEDIA_MIN_AGE_MS).toISOString();
    const filter = this.pocketbaseService
      .getClient()
      .filter('created < {:cutoff}', { cutoff });

    let page = 1;
    while (result.mediaScanned < MAX_MEDIA_PER_RUN) {
      const listed = await this.pocketbaseService.mediaMutator.getList(
        page,
        MEDIA_PAGE_SIZE,
        filter,
        'created',
        MEDIA_EXPAND
      );
      const items = listed.items as unknown as MediaWithFiles[];
      if (items.length === 0) break;

      for (const media of items) {
        result.mediaScanned += 1;
        await this.considerMedia(media, result);
      }

      await this.reportProgress(taskId, result.mediaScanned, listed.totalItems);

      if (items.length < MEDIA_PAGE_SIZE) break;
      page += 1;
    }

    if (result.mediaScanned >= MAX_MEDIA_PER_RUN) {
      this.logger.warn(
        `Ingest backfill hit the per-run scan cap (${MAX_MEDIA_PER_RUN} media); ` +
          'the remainder of the library is deferred to the next run'
      );
    }
    if (result.deferred > 0) {
      this.logger.warn(
        `Ingest backfill hit the per-run task cap (${MAX_TASKS_PER_RUN}); ` +
          `${result.deferred} media deferred to the next run`
      );
    }

    return result;
  }

  /** Plan one media and, if it owes assets, queue the work for it. */
  private async considerMedia(
    media: MediaWithFiles,
    result: IngestBackfillResult
  ): Promise<void> {
    const plan = planIngestBackfill(
      {
        mediaType: media.mediaType as MediaType,
        hasAudio: media.hasAudio,
      },
      this.readAssetStates(media)
    );

    if (plan.steps.length === 0) return;
    result.mediaNeedingWork += 1;

    // Cap reached: keep counting what is still owed (the number is the point —
    // it tells an operator how far behind the library is) but queue nothing.
    if (result.tasksCreated >= MAX_TASKS_PER_RUN) {
      result.deferred += 1;
      return;
    }

    const upload = media.expand?.UploadRef;
    const uploadId = (media.UploadRef as string) || upload?.id;
    const userRef = upload?.UserRef as string | undefined;
    if (!uploadId || !upload || !userRef) {
      result.skippedUnresolvable += 1;
      this.logger.debug(
        `Skipping media ${media.id}: upload or upload owner not resolvable`
      );
      return;
    }

    const history = await this.recentTranscodeHistory(uploadId);
    if (history.inFlight) {
      result.skippedInFlight += 1;
      return;
    }
    if (history.consecutiveFailures >= MAX_RECENT_FAILURES) {
      result.skippedFailing += 1;
      this.logger.debug(
        `Skipping media ${media.id}: ${history.consecutiveFailures} consecutive ` +
          'transcode failures in the lookback window'
      );
      return;
    }

    const payload: ProcessUploadPayload = {
      uploadId,
      mediaId: media.id,
      provider: ProcessingProvider.FFMPEG,
      origin: TaskOrigin.BACKFILL,
      ...pickIngestTranscodeConfig(media.mediaType as MediaType, plan.steps),
    };

    const created = await this.pocketbaseService.taskMutator
      .createProcessUploadTask(
        media.WorkspaceRef as string,
        userRef,
        uploadId,
        payload
      )
      .catch((error: unknown) => {
        // One unqueueable media must not end the sweep.
        this.logger.warn(
          `Failed to queue backfill for media ${media.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return null;
      });

    if (!created) return;

    result.tasksCreated += 1;
    for (const step of plan.steps) {
      result.stepCounts[step] = (result.stepCounts[step] ?? 0) + 1;
    }

    this.logger.debug(
      `Queued backfill task ${created.id} for media ${media.id}: ` +
        `missing=[${plan.missing.join(', ')}] outdated=[${plan.outdated.join(', ')}]`
    );
  }

  /**
   * What the media currently holds per asset step. A step is `present` when its
   * relation points at at least one File; its version is the LOWEST stamp
   * across those files, so one stale chunk of a filmstrip or waveform set makes
   * the whole set stale.
   */
  private readAssetStates(
    media: MediaWithFiles
  ): Partial<Record<IngestAssetStep, IngestAssetState>> {
    const states: Partial<Record<IngestAssetStep, IngestAssetState>> = {};

    for (const step of INGEST_ASSET_STEPS) {
      const relation = STEP_RELATION[step];
      const refs = media[relation];
      const ids = Array.isArray(refs) ? refs : refs ? [refs] : [];
      if (ids.length === 0) {
        states[step] = { present: false };
        continue;
      }

      const expanded = media.expand?.[relation];
      const files = Array.isArray(expanded)
        ? expanded
        : expanded
          ? [expanded]
          : [];

      states[step] = {
        present: true,
        // No expanded file (deleted out from under the relation, or a
        // projection that dropped it) leaves the version unknown, which the
        // planner reads as the baseline rather than as "outdated".
        version: files.length > 0 ? lowestIngestVersion(files) : undefined,
      };
    }

    return states;
  }

  /**
   * The upload's recent `process_upload` history: whether one is in flight, and
   * how many of the newest tasks failed consecutively. Counting from the newest
   * backwards means a single success (a user regenerating by hand, say) clears
   * the failure guard.
   */
  private async recentTranscodeHistory(uploadId: string): Promise<{
    inFlight: boolean;
    consecutiveFailures: number;
  }> {
    const since = new Date(Date.now() - FAILURE_LOOKBACK_MS).toISOString();
    const filter = this.pocketbaseService
      .getClient()
      .filter(
        'type = {:type} && sourceId = {:uploadId} && created > {:since}',
        {
          type: TaskType.PROCESS_UPLOAD,
          uploadId,
          since,
        }
      );

    const listed = await this.pocketbaseService.taskMutator.getList(
      1,
      TASK_HISTORY_PAGE_SIZE,
      filter,
      '-created'
    );

    const inFlight = listed.items.some(
      (item) =>
        item.status === TaskStatus.QUEUED || item.status === TaskStatus.RUNNING
    );

    let consecutiveFailures = 0;
    for (const item of listed.items) {
      if (item.status === TaskStatus.FAILED) {
        consecutiveFailures += 1;
        continue;
      }
      if (item.status === TaskStatus.SUCCESS) break;
      // queued/running/canceled are not evidence either way — keep looking.
    }

    return { inFlight, consecutiveFailures };
  }

  /** Progress is advisory; a failure to record it must not fail the sweep. */
  private async reportProgress(
    taskId: string,
    scanned: number,
    total: number
  ): Promise<void> {
    if (total <= 0) return;
    const progress = Math.min(
      99,
      Math.max(1, Math.round((scanned / total) * 100))
    );
    try {
      await this.pocketbaseService.updateTask(taskId, { progress });
    } catch {
      // ignore
    }
  }
}

/**
 * Lowest `meta.ingestVersion` across `files`. An unstamped file (written before
 * ingest versioning existed) counts as the baseline version rather than as
 * missing, so a legacy asset is never mistaken for a stale one — only a
 * deliberate version bump past the baseline sweeps it up.
 */
function lowestIngestVersion(files: File[]): number | undefined {
  if (files.length === 0) return undefined;
  return Math.min(
    ...files.map(
      (file) =>
        (file.meta as { ingestVersion?: number } | undefined)?.ingestVersion ??
        INGEST_BASELINE_VERSION
    )
  );
}
