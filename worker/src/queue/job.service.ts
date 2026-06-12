import { Injectable, Logger, Inject } from '@nestjs/common';
import { Task } from '@project/shared';
import { FlowService } from './flow.service';
import { ProcessorsConfigService } from '../config/processors.config';
import {
  TranscodeFlowBuilder,
  LabelsFlowBuilder,
  RenderFlowBuilder,
  FlowDefinition,
} from './flows';
import type { EnabledLabelProcessors, LabelsChildJobDefinition } from './flows';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @Inject(FlowService) private readonly flowService: FlowService,
    @Inject(ProcessorsConfigService)
    private readonly processorsConfigService: ProcessorsConfigService
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
    return this.flowService.addFlow(flow);
  }

  async submitRenderJob(task: Task): Promise<string> {
    this.logger.log(`Submitting render job for task ${task.id}`);
    const flow = RenderFlowBuilder.buildFlow(task);
    return this.flowService.addFlow(flow);
  }

  async submitFullIngestJob(
    transcodeTask: Task,
    labelsTask?: Task
  ): Promise<string> {
    this.logger.log(`Submitting full ingest job`);

    const actualLabelsTask = labelsTask || transcodeTask;

    const transcodeFlow = TranscodeFlowBuilder.buildFlow(transcodeTask);
    const labelsFlow = LabelsFlowBuilder.buildFlow(
      actualLabelsTask,
      this.enabledLabelProcessors()
    );

    // Each detection step owns an UPLOAD_TO_GCS child; nest the transcode flow
    // under the first one so transcoding completes before that branch uploads.
    // Detection runs on the ORIGINAL media file (payload.fileRef), which exists
    // before transcoding, so the other branches have no data dependency on the
    // transcode output — only this branch sequences behind it.
    const firstDetection = labelsFlow.children.find(
      (child): child is LabelsChildJobDefinition =>
        'children' in child && Array.isArray(child.children)
    );
    const uploadChild = firstDetection?.children?.[0];

    if (uploadChild) {
      if (!uploadChild.children) uploadChild.children = [];
      uploadChild.children.push(transcodeFlow as FlowDefinition);
    } else {
      // No detection steps enabled — still run the transcode before the
      // (no-op) labels parent completes.
      labelsFlow.children.push(transcodeFlow as FlowDefinition);
    }

    return this.flowService.addFlow(labelsFlow);
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
    };
  }
}
