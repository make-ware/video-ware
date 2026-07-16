import { Injectable, Logger, Inject } from '@nestjs/common';
import { Task, STEP_TO_LABEL_JOB_TYPE } from '@project/shared';
import type { DetectLabelsPayload } from '@project/shared';
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
    return this.flowService.addFlow(flow);
  }

  async submitLabelsJob(task: Task): Promise<string> {
    this.logger.log(`Submitting labels job for task ${task.id}`);
    const flow = LabelsFlowBuilder.buildFlow(
      task,
      this.enabledLabelProcessors()
    );
    const jobId = await this.flowService.addFlow(flow);
    await this.syncLabelJobs(task, flow.data.expectedSteps ?? []);
    return jobId;
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
    return this.flowService.addFlow(flow);
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
      speechTranscription: cfg.enableSpeechTranscription,
      speakerTranscription: cfg.enableSpeakerTranscription,
    };
  }
}
