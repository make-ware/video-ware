import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { FlowService } from '../queue/flow.service';
import { RenderFlowBuilder } from '../queue/flows';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import {
  Task,
  TaskStatus,
  RenderTimelinePayload,
  TimelineTrack,
  TimelineSegment,
  MediaClip,
  ClipType,
} from '@project/shared';

@Processor(QUEUE_NAMES.RENDER)
export class RenderProcessor {
  private readonly logger = new Logger(RenderProcessor.name);

  constructor(
    private readonly flowService: FlowService,
    private readonly pocketbaseService: PocketBaseService
  ) {}

  @Process('process')
  async handleRender(job: Job<Task>) {
    let task = job.data;
    this.logger.log(`Processing render task ${task.id} (job ${job.id})`);

    try {
      // Update task status to running
      await this.updateTaskStatus(task.id, TaskStatus.RUNNING, 0);

      // Pre-process: Resolve Composite Clips
      // We expand any composite clips into their constituent raw segments
      // so that the executor (FFmpeg) treats them as simple cuts.
      task = await this.resolveCompositeClips(task);

      // Create the render flow (new flow-based architecture)
      const flowDefinition = RenderFlowBuilder.buildFlow(task);
      const parentJobId = await this.flowService.addFlow(flowDefinition);

      this.logger.log(
        `Render flow created for task ${task.id}, parent job: ${parentJobId}`
      );

      // Return the parent job ID
      return { parentJobId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Render task ${task.id} failed: ${errorMessage}`,
        errorStack
      );

      // Update task status to failed with error
      await this.updateTaskStatus(
        task.id,
        TaskStatus.FAILED,
        undefined,
        undefined,
        errorMessage
      );

      // Re-throw error so Bull can handle retry logic
      throw error;
    }
  }

  /**
   * Resolves composite clips in the timeline tracks by expanding them
   * into their constituent segments.
   */
  private async resolveCompositeClips(task: Task): Promise<Task> {
    const payload = task.payload as RenderTimelinePayload;
    if (!payload.tracks) return task;

    const tracks = payload.tracks;
    const processedTracks: TimelineTrack[] = [];

    // Collect all asset IDs to fetch
    const assetIds = new Set<string>();
    for (const track of tracks) {
      for (const seg of track.segments || []) {
        if (seg.assetId) assetIds.add(seg.assetId);
      }
    }

    if (assetIds.size === 0) return task;

    // Fetch all MediaClips in one go (optimization)
    // We only care about MediaClips, so we filter by IDs that look like MediaClip IDs
    // or just try to fetch. PocketBase doesn't support "fetch any collection by ID",
    // so we assume they are MediaClip IDs if they match the pattern or we just query MediaClips.
    // However, assetId could be Media ID or MediaClip ID.
    // We'll try to fetch MediaClips. If not found, it might be Media.
    // Note: In typical flow, the segments might mix Media and MediaClip.

    // We'll fetch all matching MediaClips.
    // Since we can't easily distinguish without checking, we'll query MediaClips collection.
    // IDs that aren't MediaClips won't be returned.

    const mediaClipsMap = new Map<string, MediaClip>();

    // Chunking not implemented for brevity, assuming standard usage
    try {
      const filter = Array.from(assetIds)
        .map((id) => `id="${id}"`)
        .join('||');
      if (filter) {
        const records = await this.pocketbaseService
          .getClient()
          .collection('MediaClips')
          .getFullList<MediaClip>({ filter });

        for (const r of records) {
          mediaClipsMap.set(r.id, r);
        }
      }
    } catch (e) {
      // Ignore errors, maybe some IDs were not MediaClips
      this.logger.warn(`Error fetching media clips: ${e}`);
    }

    for (const track of tracks) {
      const newSegments: TimelineSegment[] = [];

      for (const seg of track.segments || []) {
        if (!seg.assetId) {
          newSegments.push(seg);
          continue;
        }

        const clip = mediaClipsMap.get(seg.assetId);

        // Check if it is a COMPOSITE clip
        if (
          clip &&
          clip.type === ClipType.COMPOSITE &&
          clip.clipData?.segments
        ) {
          // EXPAND
          const compositeSegments = clip.clipData.segments as {
            start: number;
            end: number;
          }[];

          // Segment Usage on Timeline
          // timeline: [time.start, time.start + time.duration]
          // source (composite): [time.sourceStart, time.sourceStart + time.duration]

          const usageSourceStart = seg.time.sourceStart || 0;
          const usageDuration = seg.time.duration;
          const usageTimelineStart = seg.time.start;
          const usageSourceEnd = usageSourceStart + usageDuration;

          // We need to find which "real" segments intersect with [usageSourceStart, usageSourceEnd]
          // Mapping Logic:
          // "Composite Time" 0 starts at beginning of compositeSegments[0]

          // 1. Build a "Composite Timeline" map
          // Map [0, S1.len) -> S1
          // Map [S1.len, S1.len + S2.len) -> S2

          let currentCompositeTime = 0;

          for (const realSeg of compositeSegments) {
            const realLen = realSeg.end - realSeg.start;
            const realSegCompositeStart = currentCompositeTime;
            const realSegCompositeEnd = currentCompositeTime + realLen;

            // Check intersection with usage range
            const intersectStart = Math.max(
              usageSourceStart,
              realSegCompositeStart
            );
            const intersectEnd = Math.min(usageSourceEnd, realSegCompositeEnd);

            if (intersectEnd > intersectStart) {
              // Intersection found!
              const intersectionLen = intersectEnd - intersectStart;

              // Offset into the Real Segment
              // unique sourceStart = realSeg.start + (intersectStart - realSegCompositeStart)
              const offsetInRealSeg = intersectStart - realSegCompositeStart;
              const finalSourceStart = realSeg.start + offsetInRealSeg;

              // Timeline Start for this piece
              // offset in usage = intersectStart - usageSourceStart
              const offsetInUsage = intersectStart - usageSourceStart;
              const finalTimelineStart = usageTimelineStart + offsetInUsage;

              newSegments.push({
                ...seg,
                id: `${seg.id}_${newSegments.length}`, // Unique ID
                assetId: clip.MediaRef, // Point to the RAW Media, NOT the Clip
                time: {
                  start: finalTimelineStart,
                  duration: intersectionLen,
                  sourceStart: finalSourceStart,
                },
              });
            }

            currentCompositeTime += realLen;
          }
        } else {
          // Pass through standard segments
          newSegments.push(seg);
        }
      }

      processedTracks.push({
        ...track,
        segments: newSegments,
      });
    }

    // Return new task with updated payload
    return {
      ...task,
      payload: {
        ...payload,
        tracks: processedTracks,
      },
    };
  }

  /**
   * Update task status in PocketBase
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    result?: unknown,
    error?: string
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = { status };

      if (progress !== undefined) {
        updates.progress = Math.round(progress);
      }

      if (result !== undefined) {
        updates.result = result;
      }

      if (error !== undefined) {
        updates.errorLog = error;
      }

      // Add timestamp for status changes
      if (status === 'running') {
        updates.startedAt = new Date().toISOString();
      } else if (status === 'success' || status === 'failed') {
        updates.completedAt = new Date().toISOString();
      }

      await this.pocketbaseService.updateTask(taskId, updates);

      this.logger.debug(
        `Updated task ${taskId} status to ${status}${progress !== undefined ? ` (${progress}%)` : ''}`
      );
    } catch (updateError) {
      this.logger.error(
        `Failed to update task ${taskId} status: ${updateError instanceof Error ? updateError.message : String(updateError)}`
      );
      // Don't throw here as it would interfere with the main processing
    }
  }

  /**
   * Update task progress in PocketBase
   */
  private async updateTaskProgress(
    taskId: string,
    progress: number
  ): Promise<void> {
    try {
      await this.pocketbaseService.updateTask(taskId, {
        progress: Math.round(progress),
      });
    } catch (error) {
      // Log but don't throw - progress updates are not critical
      this.logger.debug(
        `Failed to update task ${taskId} progress: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle job completion (success or failure)
   */
  @Process('completed')
  async handleCompleted(job: Job<Task>) {
    const task = job.data;
    this.logger.log(`Render job ${job.id} for task ${task.id} completed`);
  }

  /**
   * Handle job failure
   */
  @Process('failed')
  async handleFailed(job: Job<Task>, error: Error) {
    const task = job.data;
    this.logger.error(
      `Render job ${job.id} for task ${task.id} failed: ${error.message}`
    );

    // The task status should already be updated in the main handler,
    // but we can add additional failure handling here if needed
  }

  /**
   * Handle job stalled (taking too long)
   */
  @Process('stalled')
  async handleStalled(job: Job<Task>) {
    const task = job.data;
    this.logger.warn(`Render job ${job.id} for task ${task.id} stalled`);

    // Optionally update task status to indicate it's stalled
    await this.updateTaskStatus(
      task.id,
      TaskStatus.RUNNING,
      undefined,
      undefined,
      'Job stalled - may be retried'
    );
  }

  /**
   * Handle job progress updates
   */
  @Process('progress')
  async handleProgress(job: Job<Task>, progress: number) {
    const task = job.data;
    this.logger.debug(
      `Render job ${job.id} for task ${task.id} progress: ${progress}%`
    );
  }

  /**
   * Handle job active (started processing)
   */
  @Process('active')
  async handleActive(job: Job<Task>) {
    const task = job.data;
    this.logger.log(
      `Render job ${job.id} for task ${task.id} started processing`
    );
  }

  /**
   * Handle job waiting (queued)
   */
  @Process('waiting')
  async handleWaiting(job: Job<Task>) {
    const task = job.data;
    this.logger.debug(
      `Render job ${job.id} for task ${task.id} is waiting in queue`
    );
  }
}
