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
import type { EnabledLabelProcessors } from './flows';

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
