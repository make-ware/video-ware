import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  Task,
  STEP_TO_LABEL_JOB_TYPE,
  ProcessingProvider,
  asTaskRecordProvider,
} from '@project/shared';
import type { DetectLabelsPayload, TaskInput } from '@project/shared';
import { FlowService } from './flow.service';
import { ProcessorsConfigService } from '../config/processors.config';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import {
  TranscodeFlowBuilder,
  LabelsFlowBuilder,
  RenderFlowBuilder,
  FlowDefinition,
} from './flows';
import type { EnabledLabelProcessors } from './flows';
import type { StepType } from './types/step.types';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @Inject(FlowService) private readonly flowService: FlowService,
    @Inject(ProcessorsConfigService)
    private readonly processorsConfigService: ProcessorsConfigService,
    @Inject(PocketBaseService)
    private readonly pocketbaseService: PocketBaseService
  ) {}

  async submitTranscodeJob(task: Task): Promise<string> {
    this.logger.log(`Submitting transcode job for task ${task.id}`);
    const flow = TranscodeFlowBuilder.buildFlow(task);
    const jobId = await this.flowService.addFlow(flow);
    await this.stampEnqueueContext(
      task,
      jobId,
      flow.queueName,
      ProcessingProvider.FFMPEG
    );
    return jobId;
  }

  async submitLabelsJob(task: Task): Promise<string> {
    this.logger.log(`Submitting labels job for task ${task.id}`);
    const flow = LabelsFlowBuilder.buildFlow(
      task,
      this.enabledLabelProcessors()
    );
    const jobId = await this.flowService.addFlow(flow);
    await this.stampEnqueueContext(
      task,
      jobId,
      flow.queueName,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );
    await this.syncLabelJobs(task, flow.data.expectedSteps ?? []);
    return jobId;
  }

  /**
   * Stamp the Task record with the BullMQ context it was enqueued into (the
   * flow-root job id + queue name) and, when the record doesn't already carry
   * one, its processing provider (render tasks are created by a PB hook that
   * only stores `{ timelineRenderId }`). The hung-task watchdog cron keys its
   * staleness threshold off the record-level `provider` and reports
   * `bullJobId`/`queueName` — and a task can sit "running" in a queue backlog
   * for hours before any worker event fires, so this can't wait for the
   * flow parent's `active` event (which, for flows, only fires after all
   * children complete). Bookkeeping only: a failure here must not fail the
   * enqueue.
   */
  private async stampEnqueueContext(
    task: Task,
    bullJobId: string,
    queueName: string,
    fallbackProvider: NonNullable<TaskInput['provider']>
  ): Promise<void> {
    const updates: {
      bullJobId: string;
      queueName: string;
      provider?: TaskInput['provider'];
    } = { bullJobId, queueName };

    if (!task.provider) {
      const payloadProvider = (task.payload as { provider?: string } | null)
        ?.provider;
      updates.provider =
        asTaskRecordProvider(payloadProvider) ?? fallbackProvider;
    }

    try {
      await this.pocketbaseService.updateTask(task.id, updates);
    } catch (error) {
      this.logger.warn(
        `Failed to stamp enqueue context on task ${task.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Point each LabelJob (media × jobType) at this task for every detection
   * step the flow actually enqueued. LabelJobs is the per-type "last task
   * that ran this" index the webapp reads, and this is the single choke point
   * all detect_labels tasks pass through (webapp, ingest, CLI) — so a
   * single-type regenerate can never make the other types look missing.
   * Bookkeeping only: a failure here must not fail the enqueue.
   */
  private async syncLabelJobs(
    task: Task,
    expectedSteps: StepType[]
  ): Promise<void> {
    const payload = task.payload as DetectLabelsPayload;
    if (!payload?.mediaId) return;

    for (const stepType of expectedSteps) {
      const jobType = STEP_TO_LABEL_JOB_TYPE[stepType];
      if (!jobType) continue;
      try {
        await this.pocketbaseService.labelJobMutator.upsertForTask(
          payload.mediaId,
          jobType,
          task.id
        );
      } catch (error) {
        this.logger.warn(
          `Failed to sync LabelJob ${jobType} for task ${task.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  async submitRenderJob(task: Task): Promise<string> {
    this.logger.log(`Submitting render job for task ${task.id}`);
    const flow = RenderFlowBuilder.buildFlow(task);
    const jobId = await this.flowService.addFlow(flow);
    await this.stampEnqueueContext(
      task,
      jobId,
      flow.queueName,
      ProcessingProvider.FFMPEG
    );
    return jobId;
  }

  async submitCompositeJob(
    name: string,
    queueName: string,
    data: Record<string, unknown>,
    steps: unknown[]
  ): Promise<string> {
    this.logger.log(`Submitting composite job: ${name}`);
    return this.flowService.addFlow({
      name,
      queueName,
      data,
      children: steps,
    } as unknown as FlowDefinition);
  }

  async submitFlow(flow: FlowDefinition): Promise<string> {
    return this.flowService.addFlow(flow);
  }

  private enabledLabelProcessors(): EnabledLabelProcessors {
    const cfg = this.processorsConfigService;
    return {
      labelDetection: cfg.enableLabelDetection,
      objectTracking: cfg.enableObjectTracking,
      faceDetection: cfg.enableFaceDetection,
      personDetection: cfg.enablePersonDetection,
      textDetection: cfg.enableTextDetection,
      speechTranscription: cfg.enableSpeechTranscription,
      speakerTranscription: cfg.enableSpeakerTranscription,
    };
  }
}
